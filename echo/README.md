# Echo

> Connection without Performance

Echo is an anonymous emotional expression app. Write — or speak — what you feel. Your words are transformed by AI into an abstract visual blob and placed on a shared canvas mural. No usernames, no likes, no followers. Just feelings, made visible and reflected back to the community around you.

---

## Quickstart (for judges)

### Prerequisites

- Node.js 18+
- A [Neon](https://neon.tech) PostgreSQL database (free tier is fine)
- A [Google AI Studio](https://aistudio.google.com) API key (Gemini)
- *(Optional)* A Google Cloud service account JSON with Speech-to-Text enabled (for voice input)

### 1. Install dependencies

```bash
npm install
```

### 2. Environment variables

Create a `.env` file in the project root:

```env
DATABASE_URL='postgresql://...'
GEMINI_API_KEY='...'
GOOGLE_CLOUD_KEY_JSON='{"type":"service_account","project_id":"...","private_key":"...","client_email":"...",...}'
```
Please refer to the .env file we sent in our email.

### 3. Start the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## What to try

| Action | Where |
|---|---|
| Submit an echo | `/submit` — type (or tap the mic) and press **release** |
| Browse the mural | `/mural` — all blobs from all users |
| Find similar feelings | Tap any blob → similar blobs glow. Tap **your own** blob → "Similar Moments" panel |
| Resonate with a blob | Double-tap (or double-click) any blob |
| Review your journal | `/me` → Timeline tab |
| See your patterns | `/me` → Patterns tab (weekly chart, categories, peak times) |
| Generate an AI reflection | `/me` → Patterns tab → **Generate Insight** |

---

## How it works

### Externalisation (sharing)

1. **Release** — write something on `/submit`. Gemini analyses the emotion and assigns a colour, shape, intensity, and category (work / relationships / self). A 384-dimension embedding is generated locally via `all-MiniLM-L6-v2`.
2. **Voice input** — tap the microphone pill at the bottom of `/submit`. Audio is recorded in the browser and transcribed via Google Cloud Speech-to-Text.
3. **Mural** — all blobs appear on a shared full-screen canvas. Your own blob is highlighted with a white ring.
4. **Semantic gravity** — tap any blob to reveal others that are emotionally similar (cosine similarity via pgvector `<=>` operator). Double-tap to resonate.

### Internalisation (reflection)

5. **Journal** — `/me` shows your own echoes grouped by recency (Today / Yesterday / This Week / Earlier), with resonance counts and a glow on entries others connected with.
6. **Patterns** — a weekly activity chart (colour-coded by intensity), recurring themes, shape distribution, and peak day/time of expression.
7. **AI Insight** — on demand, Gemini reads your last 30 entries and writes a warm 2–3 sentence reflection. Cached in the session; tap **regenerate** to refresh.
8. **Similar Moments** — tapping your own blob on the mural shows a bottom sheet of your past entries with the highest semantic similarity to that feeling, ending with: *"This feeling comes and goes. You've moved through it before."*

---

## Tech stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| Database | Neon (PostgreSQL + pgvector) |
| AI — emotion analysis | Google Gemini `gemini-1.5-flash` |
| AI — embeddings | `@xenova/transformers` · `all-MiniLM-L6-v2` (384-dim, runs locally) |
| AI — reflection | Google Gemini `gemini-1.5-flash` |
| Voice input | Google Cloud Speech-to-Text (`WEBM_OPUS`) |
| Styling | Tailwind CSS |
| Language | TypeScript |

---

## Project structure

```
app/
  page.tsx              # Landing page
  mural/page.tsx        # Full-screen canvas mural
  submit/page.tsx       # Echo submission form + voice recorder
  me/page.tsx           # Personal journal, patterns, AI insight
  api/
    entry/              # POST  — analyse text, insert blob
    stream/             # GET   — fetch blobs; similarity search via ?entry_id=
    resonate/           # POST  — record a resonance
    speech/             # POST  — voice transcription (Google Cloud STT)
    me/
      entries/          # GET   — user's journal entries with resonance counts
      patterns/         # GET   — emotional pattern data (?timeframe=week|month|all)
      insight/          # POST  — AI-generated reflection (Gemini)
      similar/          # GET   — semantically similar past entries (own history)

components/
  Mural.tsx             # Canvas rendering, hit-testing, glow animation, similar moments panel
  BlobPreview.tsx       # Animated blob preview (success screen & journal)
  SiriRecorder.tsx      # Voice recorder UI + transcription flow

lib/
  ai.ts                 # Gemini emotion analysis + embedding pipeline
  db.ts                 # Neon SQL client
  shapes.ts             # Canvas shape drawing (smooth / spiky / jagged)
  types.ts              # Shared TypeScript interfaces
  user.ts               # Anonymous user ID (localStorage UUID)

scripts/
  seed.ts               # Seed 50 emotional messages
  migrate.js            # Run schema migrations against Neon

sql/
  migrate_v2.sql        # Adds intensity + category columns
```

---

## API reference

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/entry` | Submit an echo. Body: `{ text, user_id }` |
| `GET` | `/api/stream` | All blobs. Add `?entry_id=` for cosine-similarity results |
| `POST` | `/api/resonate` | Resonate with a blob. Body: `{ target_id, actor_id }` |
| `POST` | `/api/speech` | Transcribe audio. Body: `{ audio }` (base64 webm) |
| `GET` | `/api/me/entries` | User's journal entries. Query: `userId` |
| `GET` | `/api/me/patterns` | Pattern analytics. Query: `userId`, `timeframe` |
| `POST` | `/api/me/insight` | AI reflection. Body: `{ userId, timeframe }` |
| `GET` | `/api/me/similar` | Similar past entries. Query: `entryId`, `userId` |