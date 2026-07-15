create function public.workspace_update_shortlist_entry_metadata(
  p_org_id uuid,
  p_shortlist_id uuid,
  p_entry_id uuid,
  p_actor_user_id uuid,
  p_tags text[] default '{}',
  p_notes text default null
)
returns public.shortlist_entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  shortlist_status text;
  normalized_tags text[];
  next_entry public.shortlist_entries;
begin
  if not exists (
    select 1
    from public.memberships
    where org_id = p_org_id
      and user_id = p_actor_user_id
      and status = 'active'
      and role = any(array['owner', 'admin', 'marketer'])
  ) then
    raise exception using errcode = '42501', message = 'A workspace manager role is required.';
  end if;

  select coalesce(array_agg(tag order by ordinal), '{}'::text[])
  into normalized_tags
  from (
    select distinct on (lower(trim(input_tag)))
      trim(input_tag) as tag,
      input_ordinal as ordinal
    from unnest(coalesce(p_tags, '{}'::text[])) with ordinality as input(input_tag, input_ordinal)
    where trim(input_tag) <> ''
    order by lower(trim(input_tag)), input_ordinal
  ) deduplicated_tags;

  if coalesce(cardinality(normalized_tags), 0) > 8 then
    raise exception using errcode = '22023', message = 'Add no more than eight creator tags.';
  end if;
  if exists (select 1 from unnest(normalized_tags) as tag where char_length(tag) > 40) then
    raise exception using errcode = '22023', message = 'Creator tags must be 40 characters or fewer.';
  end if;
  if char_length(coalesce(p_notes, '')) > 1000 then
    raise exception using errcode = '22023', message = 'Creator notes must be 1,000 characters or fewer.';
  end if;

  select status into shortlist_status
  from public.shortlists
  where org_id = p_org_id and id = p_shortlist_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Shortlist not found.';
  end if;
  if shortlist_status not in ('draft', 'review') then
    raise exception using errcode = 'P0001', message = 'Reopen the shortlist before editing creator notes or tags.';
  end if;

  update public.shortlist_entries
  set
    tags = normalized_tags,
    notes = nullif(trim(coalesce(p_notes, '')), '')
  where org_id = p_org_id
    and shortlist_id = p_shortlist_id
    and id = p_entry_id
  returning * into next_entry;
  if not found then
    raise exception using errcode = 'P0002', message = 'Shortlist creator not found.';
  end if;

  insert into public.audit_events (
    org_id,
    actor_user_id,
    event_type,
    entity_type,
    entity_id,
    payload
  ) values (
    p_org_id,
    p_actor_user_id,
    'shortlist.creator_metadata_updated',
    'shortlist_entry',
    p_entry_id,
    jsonb_build_object(
      'shortlist_id', p_shortlist_id,
      'tags', to_jsonb(normalized_tags),
      'notes_present', next_entry.notes is not null
    )
  );

  return next_entry;
end;
$$;

revoke all on function public.workspace_update_shortlist_entry_metadata(uuid, uuid, uuid, uuid, text[], text)
from public, anon, authenticated;
grant execute on function public.workspace_update_shortlist_entry_metadata(uuid, uuid, uuid, uuid, text[], text)
to service_role;

comment on function public.workspace_update_shortlist_entry_metadata(uuid, uuid, uuid, uuid, text[], text)
  is 'Server-only role-checked creator notes and tags workflow with immutable audit history.';
