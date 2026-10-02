-- Upserts (ON CONFLICT (wa_message_id)) need a real unique constraint, not a
-- partial index. Unique constraints already allow many NULLs (unsent messages).
drop index if exists public.messages_wa_message_id_uniq;
alter table public.messages add constraint messages_wa_message_id_key unique (wa_message_id);
