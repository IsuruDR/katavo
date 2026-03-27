-- 00004_storage.sql
-- Storage bucket for podcast audio files

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'podcast-audio',
  'podcast-audio',
  false,
  52428800, -- 50MB max
  array['audio/mpeg', 'audio/mp3', 'audio/wav']
);

-- Users can read their own audio files
create policy "Users can read own audio"
  on storage.objects for select
  using (
    bucket_id = 'podcast-audio'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Service role can insert audio (pipeline writes via service key)
-- No insert policy for users — only the pipeline writes audio
