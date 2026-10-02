-- Column-level privileges for dashboard users. RLS decides WHICH rows a member
-- can update; these grants decide WHICH columns. Server-computed fields (sales
-- stage, AI state, attribution, customer totals) stay service-role only.

revoke update on public.conversations from authenticated;
grant update (ai_mode, assigned_to, status, needs_attention, unread_count) on public.conversations to authenticated;

revoke update on public.customers from authenticated;
grant update (name, email, address, notes, status, marketing_opt_in, metadata) on public.customers to authenticated;

-- Insert on customers is server-side only (created from WhatsApp).
revoke insert on public.customers from authenticated;
