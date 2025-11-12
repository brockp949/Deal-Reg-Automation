-- File deduplication support

ALTER TABLE source_files
  ADD COLUMN IF NOT EXISTS duplicate_of_id UUID REFERENCES source_files(id);

CREATE INDEX IF NOT EXISTS idx_source_files_duplicate_of
  ON source_files(duplicate_of_id);
