-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create entries table
CREATE TABLE IF NOT EXISTS entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  message VARCHAR(284) NOT NULL,
  embedding vector(384),
  color VARCHAR(7),
  shape VARCHAR(20),
  x INT,
  y INT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create resonances table
CREATE TABLE IF NOT EXISTS resonances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_entry_id UUID REFERENCES entries(id) ON DELETE CASCADE,
  actor_entry_id UUID REFERENCES entries(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Index for vector similarity search
CREATE INDEX IF NOT EXISTS entries_embedding_idx ON entries USING ivfflat (embedding vector_cosine_ops);
