-- =============================================================================
-- AI auto-resume: when a person has taken over a conversation but the customer
-- has waited this many minutes without a reply from the team, the AI picks the
-- conversation back up (whatsapp-sweep). 0 = never; "Paused" never resumes.
-- =============================================================================

alter table public.ai_settings
  add column ai_resume_after_minutes integer not null default 15
    check (ai_resume_after_minutes between 0 and 1440);

-- The sweep scans open, human-handled conversations by the customer's last message.
create index conversations_human_waiting_idx on public.conversations (last_customer_message_at)
  where status = 'open' and ai_mode = 'HUMAN_ACTIVE';
