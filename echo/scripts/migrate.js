const fs = require('fs');
const path = require('path');

// Load .env (handles single/double quoted values)
fs.readFileSync(path.join(__dirname, '../.env'), 'utf8')
  .split('\n')
  .forEach(line => {
    const [key, ...rest] = line.split('=');
    if (!key?.trim() || !rest.length) return;
    let value = rest.join('=').trim();
    if ((value.startsWith("'") && value.endsWith("'")) ||
        (value.startsWith('"') && value.endsWith('"'))) {
      value = value.slice(1, -1);
    }
    process.env[key.trim()] = value;
  });

// Strip channel_binding — not supported by @neondatabase/serverless
if (process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.DATABASE_URL
    .replace(/&channel_binding=[^&]*/g, '')
    .replace(/\?channel_binding=[^&]*&/, '?')
    .replace(/\?channel_binding=[^&]*$/, '');
}

const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function migrate() {
  console.log('Running migrations...\n');

  // v1 — initial schema (each statement separately)
  await sql`CREATE EXTENSION IF NOT EXISTS vector`;
  await sql`
    CREATE TABLE IF NOT EXISTS entries (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     UUID,
      message     VARCHAR(284) NOT NULL,
      embedding   vector(384),
      color       VARCHAR(7),
      shape       VARCHAR(20),
      x           INT,
      y           INT,
      created_at  TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS resonances (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      target_entry_id  UUID REFERENCES entries(id) ON DELETE CASCADE,
      actor_entry_id   UUID REFERENCES entries(id) ON DELETE CASCADE,
      created_at       TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS entries_embedding_idx
    ON entries USING ivfflat (embedding vector_cosine_ops)
  `;
  console.log('✓ v1 — initial schema');

  // v2 — add intensity and category columns
  await sql`ALTER TABLE entries ADD COLUMN IF NOT EXISTS intensity SMALLINT`;
  await sql`ALTER TABLE entries ADD COLUMN IF NOT EXISTS category  VARCHAR(20)`;
  console.log('✓ v2 — intensity, category columns');

  console.log('\nDone.');
  process.exit(0);
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
