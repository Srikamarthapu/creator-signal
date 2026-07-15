alter table public.agent_action_confirmations
  add column position integer not null default 0 check (position between 0 and 9);

create index agent_action_confirmations_message_position_idx
  on public.agent_action_confirmations(org_id, assistant_message_id, position, created_at);

comment on column public.agent_action_confirmations.position
  is 'Stable display order assigned by the source-backed recommendation turn.';
