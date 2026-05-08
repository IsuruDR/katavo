-- 00018_drop_trusted_sources.sql
-- Drop the trusted_sources feature. The Pro tier doesn't need a unique
-- "feature" wedge — it differentiates on volume + Deep Dive minutes,
-- like the standard AI app pattern (ChatGPT/Claude/Cursor). The
-- trusted_sources table was a holdover from the original v3 design and
-- isn't worth maintaining: PRODUCT.md explicitly rejects power-user
-- workflows ("not professionals managing a content pipeline") and
-- url-curation is exactly that.
--
-- Pipeline already stopped consuming trustedSourceUrls when the v11
-- research-agent rewrite dropped the deepResearch.ts node — the field
-- was dead state being threaded from submit-podcast through the queue
-- without any reader. This migration completes the removal at the DB
-- layer.
--
-- CASCADE drops the four RLS policies (00002) + the updated_at trigger
-- (00001) along with the table.

DROP TABLE IF EXISTS public.trusted_sources CASCADE;
