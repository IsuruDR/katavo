-- 00009_realtime_publication.sql
-- Add tables to the supabase_realtime publication so postgres_changes events
-- fire for them. Without this, the mobile usePodcasts subscription is silent
-- and the library never auto-refreshes.
ALTER PUBLICATION supabase_realtime ADD TABLE public.podcasts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.subscriptions;
