alter table public.conversation_messages
  add constraint conversation_messages_org_conversation_id_id_key
  unique (org_id, conversation_id, id);

create table public.agent_action_confirmations (
  id uuid primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null,
  assistant_message_id uuid not null,
  research_run_id uuid not null,
  agent_run_id uuid references public.agent_runs(id) on delete set null,
  requested_by uuid not null references auth.users(id) on delete restrict,
  action_type text not null check (action_type in ('save_creator')),
  status text not null default 'pending' check (status in ('pending', 'processing', 'complete', 'failed')),
  action_payload jsonb not null check (jsonb_typeof(action_payload) = 'object'),
  result_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(result_payload) = 'object'),
  confirmed_by uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, conversation_id)
    references public.conversations(org_id, id) on delete cascade,
  foreign key (org_id, research_run_id)
    references public.research_runs(org_id, id) on delete cascade,
  foreign key (org_id, conversation_id, assistant_message_id)
    references public.conversation_messages(org_id, conversation_id, id) on delete cascade,
  check (
    (status = 'pending' and confirmed_by is null and confirmed_at is null)
    or (status in ('processing', 'complete', 'failed') and confirmed_by is not null and confirmed_at is not null)
  )
);

create index agent_action_confirmations_conversation_idx
  on public.agent_action_confirmations(org_id, conversation_id, created_at);

create index agent_action_confirmations_message_idx
  on public.agent_action_confirmations(org_id, assistant_message_id);

create index agent_action_confirmations_pending_idx
  on public.agent_action_confirmations(org_id, status, updated_at)
  where status in ('pending', 'processing', 'failed');

create trigger agent_action_confirmations_set_updated_at
before update on public.agent_action_confirmations
for each row execute function public.set_updated_at();

alter table public.agent_action_confirmations enable row level security;

create policy agent_action_confirmations_select_members
on public.agent_action_confirmations
for select to authenticated
using (public.is_org_member(org_id));

revoke all on public.agent_action_confirmations from public, anon, authenticated;
grant select on public.agent_action_confirmations to authenticated;
grant all on public.agent_action_confirmations to service_role;

comment on table public.agent_action_confirmations
  is 'Server-owned, source-backed agent proposals that require an explicit authorized user confirmation before changing workspace data.';

comment on column public.agent_action_confirmations.action_payload
  is 'Canonical server-generated action input. Browser confirmation requests never supply or replace this payload.';
