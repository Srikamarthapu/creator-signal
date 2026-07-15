create table public.conversation_research_runs (
  org_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null,
  research_run_id uuid not null,
  linked_by uuid not null references auth.users(id) on delete restrict,
  linked_at timestamptz not null default now(),
  primary key (conversation_id, research_run_id),
  foreign key (org_id, conversation_id)
    references public.conversations(org_id, id) on delete cascade,
  foreign key (org_id, research_run_id)
    references public.research_runs(org_id, id) on delete cascade
);

create index conversation_research_runs_research_idx
  on public.conversation_research_runs(org_id, research_run_id, linked_at desc);

create index conversations_org_research_updated_idx
  on public.conversations(org_id, research_run_id, updated_at desc)
  where research_run_id is not null;

alter table public.conversation_research_runs enable row level security;

create policy conversation_research_runs_select_members
on public.conversation_research_runs
for select to authenticated
using (public.is_org_member(org_id));

revoke all on public.conversation_research_runs from public, anon, authenticated;
grant select on public.conversation_research_runs to authenticated;
grant all on public.conversation_research_runs to service_role;

revoke insert, update, delete on public.conversations from authenticated;

comment on table public.conversation_research_runs
  is 'Server-owned links that preserve one campaign conversation across every source-backed research run it launches.';

comment on column public.conversations.research_run_id
  is 'The most recently linked research run; full conversation history is retained in conversation_research_runs.';
