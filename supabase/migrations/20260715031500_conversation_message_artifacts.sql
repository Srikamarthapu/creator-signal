alter table public.conversation_messages
  add column artifacts jsonb not null default '[]'::jsonb,
  add constraint conversation_messages_artifacts_array
    check (jsonb_typeof(artifacts) = 'array');

comment on column public.conversation_messages.artifacts
  is 'Server-owned structured artifacts generated during an agent turn, such as source-backed outreach drafts.';
