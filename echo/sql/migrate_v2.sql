-- Add intensity and category columns to entries
ALTER TABLE entries ADD COLUMN IF NOT EXISTS intensity SMALLINT;
ALTER TABLE entries ADD COLUMN IF NOT EXISTS category  VARCHAR(20);
