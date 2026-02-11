# Echo

> Connection without Performance

Echo is an anonymous emotional expression app. Write what you feel — your words are transformed by AI into an abstract visual blob and placed on a shared canvas mural. No usernames, no likes, no followers. Just feelings, made visible.

## How it works

1. **Release** — write something on `/submit`. Gemini analyses the emotion and assigns a colour, shape, and intensity. A 384-dimension embedding is generated locally via `all-MiniLM-L6-v2`.
2. **Mural** — all blobs appear on a shared full-screen canvas at `/mural`. Your own blob is highlighted with a white ring.
3. **Semantic gravity** — tap any blob to reveal others that are emotionally similar (cosine similarity via pgvector). Double-tap to resonate with a blob.

## Tech stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| Database | Neon (PostgreSQL + pgvector) |
| AI — emotion | Google Gemini (`gemini-1.5-flash`) |
| AI — embeddings | Xenova/all-MiniLM-L6-v2 (384-dim, runs locally) |
| Styling | Tailwind CSS |
| Language | TypeScript |

## Project structure

```
app/
  page.tsx          # Landing page
  mural/page.tsx    # Full-screen canvas mural
  submit/page.tsx   # Echo submission form
  api/
    entry/          # POST — analyse text, insert blob
    stream/         # GET  — fetch blobs; similarity search via ?entry_id=
    resonate/       # POST — record a resonance

components/
  Mural.tsx         # Canvas rendering, hit-testing, glow animation
  BlobPreview.tsx   # Animated blob preview (success screen)

lib/
  ai.ts             # Gemini emotion analysis + embedding pipeline
  db.ts             # Neon SQL client
  shapes.ts         # Canvas shape drawing (smooth / spiky / jagged)
  types.ts          # Shared TypeScript interfaces
  user.ts           # Anonymous user ID (localStorage)

scripts/
  seed.ts           # Seed 50 emotional messages into the database
  migrate.js        # Run sql/init.sql against Neon

sql/
  init.sql          # Schema: entries, resonances, ivfflat index
```

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Environment variables

Create a `.env` file in the project root:

```env
DATABASE_URL='postgresql://...'
GEMINI_API_KEY='...'
GOOGLE_CLOUD_KEY_JSON='...'
```

- `DATABASE_URL` — your Neon connection string (from the Neon dashboard)
- `GEMINI_API_KEY` — from [Google AI Studio](https://aistudio.google.com)
- `GOOGLE_CLOUD_KEY_JSON` — your Google Cloud service account JSON key (must have Cloud Speech-to-Text API enabled)

To get the Google Cloud key:
1. Go to Google Cloud Console
2. Create a service account or use existing one
3. Enable Cloud Speech-to-Text API
4. Generate a new JSON key and paste the entire object as the value

### 3. Run the database migration

```bash
npm run migrate
```

### 4. (Optional) Seed the database

```bash
npm run seed
```

Seeds 50 pre-written emotional messages. Requires a Gemini API key with available quota. Processes sequentially at one request per 4 seconds to stay within the free-tier rate limit.

### 5. Start the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm run migrate` | Run database migration |
| `npm run seed` | Seed 50 entries |
| `npm run test:ai` | Test the AI pipeline |
