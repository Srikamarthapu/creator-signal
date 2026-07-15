create extension if not exists pgmq;
select pgmq.create('provider_retries');

create table public.provider_retry_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  provider_job_id uuid references public.provider_jobs(id) on delete set null,
  requested_by uuid not null references auth.users(id) on delete restrict,
  research_run_id uuid not null,
  provider text not null check (provider in ('bright_data')),
  operation text not null check (operation in ('creator_discovery', 'product_research')),
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'complete', 'failed', 'cancelled')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 20000),
  attempt_count integer not null default 0 check (attempt_count between 0 and 10),
  max_attempts integer not null default 3 check (max_attempts between 1 and 5),
  queue_message_id bigint,
  available_at timestamptz not null default now(),
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  last_error_category text check (last_error_category is null or char_length(last_error_category) <= 80),
  last_error_summary text check (last_error_summary is null or char_length(last_error_summary) <= 500),
  result_summary jsonb not null default '{}'::jsonb check (jsonb_typeof(result_summary) = 'object'),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, research_run_id) references public.research_runs(org_id, id) on delete cascade
);

alter table public.provider_jobs
  add column retry_job_id uuid references public.provider_retry_jobs(id) on delete set null;

create index provider_retry_jobs_org_created_idx
  on public.provider_retry_jobs(org_id, created_at desc);
create index provider_retry_jobs_ready_idx
  on public.provider_retry_jobs(status, available_at)
  where status = 'queued';
create unique index provider_retry_jobs_active_operation_idx
  on public.provider_retry_jobs(org_id, research_run_id, operation)
  where status in ('queued', 'processing');

create trigger provider_retry_jobs_set_updated_at
before update on public.provider_retry_jobs
for each row execute function public.set_updated_at();

alter table public.provider_retry_jobs enable row level security;
revoke all on public.provider_retry_jobs from anon, authenticated;
grant all on public.provider_retry_jobs to service_role;

create function public.provider_retry_create(
  p_org_id uuid,
  p_requested_by uuid,
  p_research_run_id uuid,
  p_provider_job_id uuid,
  p_operation text,
  p_payload jsonb,
  p_max_attempts integer default 3
)
returns public.provider_retry_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  retry_job public.provider_retry_jobs;
begin
  if not exists (
    select 1
    from public.memberships
    where org_id = p_org_id
      and user_id = p_requested_by
      and status = 'active'
      and role = any(array['owner', 'admin', 'marketer'])
  ) then
    raise exception using errcode = '42501', message = 'A workspace manager role is required.';
  end if;
  if p_operation not in ('creator_discovery', 'product_research') then
    raise exception using errcode = '22023', message = 'Choose a retryable provider operation.';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or octet_length(p_payload::text) > 20000 then
    raise exception using errcode = '22023', message = 'Provide a bounded provider retry payload.';
  end if;
  if p_max_attempts not between 1 and 5 then
    raise exception using errcode = '22023', message = 'Provider retries must allow between one and five attempts.';
  end if;
  if not exists (
    select 1 from public.research_runs
    where org_id = p_org_id and id = p_research_run_id
  ) then
    raise exception using errcode = 'P0002', message = 'Research run not found.';
  end if;
  if p_provider_job_id is not null and not exists (
    select 1 from public.provider_jobs
    where org_id = p_org_id and id = p_provider_job_id
  ) then
    raise exception using errcode = 'P0002', message = 'Provider job not found.';
  end if;

  select * into retry_job
  from public.provider_retry_jobs
  where org_id = p_org_id
    and research_run_id = p_research_run_id
    and operation = p_operation
    and status in ('queued', 'processing')
  order by created_at desc
  limit 1
  for update;
  if found then
    return retry_job;
  end if;

  insert into public.provider_retry_jobs (
    org_id,
    provider_job_id,
    requested_by,
    research_run_id,
    provider,
    operation,
    payload,
    max_attempts
  ) values (
    p_org_id,
    p_provider_job_id,
    p_requested_by,
    p_research_run_id,
    'bright_data',
    p_operation,
    p_payload,
    p_max_attempts
  ) returning * into retry_job;

  select * into message_id
  from pgmq.send(
    'provider_retries',
    jsonb_build_object('retry_id', retry_job.id),
    0
  );

  update public.provider_retry_jobs
  set queue_message_id = message_id
  where id = retry_job.id
  returning * into retry_job;

  if p_provider_job_id is not null then
    update public.provider_jobs
    set retry_job_id = retry_job.id
    where org_id = p_org_id and id = p_provider_job_id;
  end if;

  insert into public.audit_events (
    org_id,
    actor_user_id,
    event_type,
    entity_type,
    entity_id,
    request_id,
    payload
  ) values (
    p_org_id,
    p_requested_by,
    'provider.retry_queued',
    'provider_retry_job',
    retry_job.id,
    retry_job.id,
    jsonb_build_object(
      'research_run_id', p_research_run_id,
      'provider_job_id', p_provider_job_id,
      'operation', p_operation,
      'max_attempts', p_max_attempts
    )
  );

  return retry_job;
end;
$$;

create function public.provider_retry_read(
  p_visibility_seconds integer default 120,
  p_quantity integer default 2
)
returns table (
  message_id bigint,
  read_count bigint,
  enqueued_at timestamptz,
  visible_at timestamptz,
  message jsonb
)
language sql
security definer
set search_path = ''
as $$
  select
    queued.msg_id,
    queued.read_ct,
    queued.enqueued_at,
    queued.vt,
    queued.message
  from pgmq.read(
    'provider_retries',
    greatest(30, least(p_visibility_seconds, 900)),
    greatest(1, least(p_quantity, 10))
  ) as queued;
$$;

create function public.provider_retry_claim(
  p_retry_id uuid,
  p_lease_seconds integer default 120
)
returns public.provider_retry_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  retry_job public.provider_retry_jobs;
begin
  update public.provider_retry_jobs
  set
    status = 'failed',
    completed_at = now(),
    lease_expires_at = null,
    last_error_category = 'worker_lease_expired',
    last_error_summary = 'The provider worker lease expired after the final allowed attempt.'
  where id = p_retry_id
    and status = 'processing'
    and lease_expires_at <= now()
    and attempt_count >= max_attempts;

  select * into retry_job
  from public.provider_retry_jobs
  where id = p_retry_id
    and attempt_count < max_attempts
    and (
      (status = 'queued' and available_at <= now())
      or (status = 'processing' and lease_expires_at <= now())
    )
  for update skip locked;
  if not found then
    return null;
  end if;

  update public.provider_retry_jobs
  set
    status = 'processing',
    attempt_count = attempt_count + 1,
    claimed_at = now(),
    lease_expires_at = now() + pg_catalog.make_interval(secs => greatest(30, least(p_lease_seconds, 900)))
  where id = p_retry_id
  returning * into retry_job;
  return retry_job;
end;
$$;

create function public.provider_retry_complete(
  p_retry_id uuid,
  p_result_summary jsonb default '{}'::jsonb
)
returns public.provider_retry_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  retry_job public.provider_retry_jobs;
begin
  update public.provider_retry_jobs
  set
    status = 'complete',
    result_summary = case when jsonb_typeof(coalesce(p_result_summary, '{}'::jsonb)) = 'object' then coalesce(p_result_summary, '{}'::jsonb) else '{}'::jsonb end,
    completed_at = now(),
    lease_expires_at = null,
    last_error_category = null,
    last_error_summary = null
  where id = p_retry_id and status = 'processing'
  returning * into retry_job;
  if not found then
    raise exception using errcode = 'P0002', message = 'Processing provider retry not found.';
  end if;

  return retry_job;
end;
$$;

create function public.provider_retry_fail(
  p_retry_id uuid,
  p_error_category text,
  p_error_summary text,
  p_requeue boolean,
  p_delay_seconds integer default 0
)
returns public.provider_retry_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  retry_job public.provider_retry_jobs;
  message_id bigint;
begin
  update public.provider_retry_jobs
  set
    status = case when p_requeue and attempt_count < max_attempts then 'queued' else 'failed' end,
    available_at = now() + pg_catalog.make_interval(secs => greatest(0, least(p_delay_seconds, 3600))),
    lease_expires_at = null,
    last_error_category = left(trim(coalesce(p_error_category, 'provider_unavailable')), 80),
    last_error_summary = nullif(left(trim(coalesce(p_error_summary, '')), 500), ''),
    completed_at = case when p_requeue and attempt_count < max_attempts then null else now() end
  where id = p_retry_id and status = 'processing'
  returning * into retry_job;
  if not found then
    raise exception using errcode = 'P0002', message = 'Processing provider retry not found.';
  end if;

  if retry_job.status = 'queued' then
    select * into message_id
    from pgmq.send(
      'provider_retries',
      jsonb_build_object('retry_id', retry_job.id),
      greatest(0, least(p_delay_seconds, 3600))
    );

    update public.provider_retry_jobs
    set queue_message_id = message_id
    where id = retry_job.id
    returning * into retry_job;
  end if;

  return retry_job;
end;
$$;

create function public.provider_retry_enqueue(
  p_retry_id uuid,
  p_delay_seconds integer default 0
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  message_id bigint;
begin
  if not exists (
    select 1 from public.provider_retry_jobs
    where id = p_retry_id and status = 'queued'
  ) then
    raise exception using errcode = 'P0002', message = 'Queued provider retry not found.';
  end if;

  select * into message_id
  from pgmq.send(
    'provider_retries',
    jsonb_build_object('retry_id', p_retry_id),
    greatest(0, least(p_delay_seconds, 3600))
  );

  update public.provider_retry_jobs
  set
    queue_message_id = message_id,
    available_at = now() + pg_catalog.make_interval(secs => greatest(0, least(p_delay_seconds, 3600)))
  where id = p_retry_id;
  return message_id;
end;
$$;

create function public.provider_retry_archive(p_message_id bigint)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select pgmq.archive('provider_retries', p_message_id);
$$;

create function public.provider_retry_metrics()
returns table (
  queue_length bigint,
  newest_message_age_seconds integer,
  oldest_message_age_seconds integer,
  total_messages bigint
)
language sql
security definer
set search_path = ''
as $$
  select
    metrics.queue_length,
    metrics.newest_msg_age_sec,
    metrics.oldest_msg_age_sec,
    metrics.total_messages
  from pgmq.metrics('provider_retries') as metrics;
$$;

revoke all on function public.provider_retry_create(uuid, uuid, uuid, uuid, text, jsonb, integer) from public, anon, authenticated;
revoke all on function public.provider_retry_read(integer, integer) from public, anon, authenticated;
revoke all on function public.provider_retry_claim(uuid, integer) from public, anon, authenticated;
revoke all on function public.provider_retry_complete(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.provider_retry_fail(uuid, text, text, boolean, integer) from public, anon, authenticated;
revoke all on function public.provider_retry_enqueue(uuid, integer) from public, anon, authenticated;
revoke all on function public.provider_retry_archive(bigint) from public, anon, authenticated;
revoke all on function public.provider_retry_metrics() from public, anon, authenticated;

grant execute on function public.provider_retry_create(uuid, uuid, uuid, uuid, text, jsonb, integer) to service_role;
grant execute on function public.provider_retry_read(integer, integer) to service_role;
grant execute on function public.provider_retry_claim(uuid, integer) to service_role;
grant execute on function public.provider_retry_complete(uuid, jsonb) to service_role;
grant execute on function public.provider_retry_fail(uuid, text, text, boolean, integer) to service_role;
grant execute on function public.provider_retry_enqueue(uuid, integer) to service_role;
grant execute on function public.provider_retry_archive(bigint) to service_role;
grant execute on function public.provider_retry_metrics() to service_role;

comment on table public.provider_retry_jobs
  is 'Server-only durable provider retry state. Request payloads are never exposed to browser clients or support views.';
comment on function public.provider_retry_create(uuid, uuid, uuid, uuid, text, jsonb, integer)
  is 'Atomically creates one active provider retry per research operation and enqueues its bounded server-only payload.';
