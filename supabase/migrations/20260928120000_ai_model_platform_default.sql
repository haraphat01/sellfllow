-- NULL model = use the platform default (AI_DEFAULT_MODEL), so installations
-- can choose their provider without every business pinning one model.
alter table public.ai_agents alter column model drop default;
alter table public.ai_agents alter column model drop not null;
