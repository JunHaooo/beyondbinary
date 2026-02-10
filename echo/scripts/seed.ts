import fs from 'fs';
import path from 'path';

// Load .env before importing ai/db modules — both initialise at import time
fs.readFileSync(path.join(__dirname, '../.env'), 'utf8')
  .split('\n')
  .forEach(line => {
    const [key, ...rest] = line.split('=');
    if (!key?.trim() || !rest.length) return;
    let value = rest.join('=').trim();
    // Strip surrounding single or double quotes (dotenv-style values)
    if ((value.startsWith("'") && value.endsWith("'")) ||
        (value.startsWith('"') && value.endsWith('"'))) {
      value = value.slice(1, -1);
    }
    process.env[key.trim()] = value;
  });

// @neondatabase/serverless does not recognise the channel_binding query param
// that Neon now appends to connection strings. Strip it so neon() accepts the URL.
if (process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.DATABASE_URL
    .replace(/&channel_binding=[^&]*/g, '')
    .replace(/\?channel_binding=[^&]*&/, '?')
    .replace(/\?channel_binding=[^&]*$/, '');
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { analyseEntry } = require('../lib/ai') as typeof import('../lib/ai');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { sql } = require('../lib/db') as typeof import('../lib/db');

// ── Messages ─────────────────────────────────────────────────────────────────

const MESSAGES: string[] = [
  // Work / school (15)
  'School is exhausting',
  "My boss doesn't appreciate me",
  'Deadlines are crushing me',
  'I failed my exam and I feel like a failure',
  'My teacher singled me out in front of the whole class',
  "I can't keep up with everything anymore",
  'I got rejected from the internship I wanted',
  'I work so hard but it never feels like enough',
  "I have a presentation tomorrow and I'm not ready",
  "My group project partners aren't pulling their weight",
  'I studied all night and still did badly',
  'The pressure to succeed is suffocating',
  "I don't know what career I actually want",
  'Everyone around me seems to have it figured out',
  "I'm falling behind and I don't know how to catch up",

  // Relationships (15)
  "I feel lonely even when I'm surrounded by people",
  "My friend doesn't understand me anymore",
  'Family expectations feel impossible to meet',
  "I said something I regret and I can't take it back",
  "I feel like I'm being replaced in my friend group",
  "My parents keep arguing and I don't know what to do",
  'No one checked in on me today',
  "I pushed someone away and I don't know why",
  'I feel invisible to the people I care about most',
  'My closest friend is slowly drifting away',
  "I'm terrified of being abandoned",
  "I can't tell if they actually care about me",
  'I wish I had someone I could talk to right now',
  'I feel like a burden to everyone in my life',
  'The person I trusted most broke my trust',

  // Self (20)
  "I'm proud of myself today",
  'Why am I like this',
  "I don't think I'm good enough",
  'I keep making the same mistakes over and over',
  'I did something scary today and I am glad I did it',
  "I don't recognise myself lately",
  "I'm trying my hardest and it still feels like failure",
  'I actually feel okay today and that means something',
  'I hate the way I look sometimes',
  "I'm so tired of pretending to be fine",
  'Something small made me happy today',
  'I feel like no one truly knows me',
  "I'm getting better, slowly",
  'I am my own worst enemy',
  'I chose myself today and it felt right',
  "I'm afraid of going back to who I used to be",
  "I can't stop overthinking",
  "I'm softer than I let people see",
  'I had a moment of clarity today',
  "I'm still here and that's enough",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function seedEntry(message: string, index: number): Promise<boolean> {
  try {
    const userId = crypto.randomUUID();
    const { color, shape, embedding } = await analyseEntry(message);
    const x = Math.floor(50 + Math.random() * 700); // 50–750
    const y = Math.floor(50 + Math.random() * 500); // 50–550
    const embeddingLiteral = `[${embedding.join(',')}]`;

    await sql`
      INSERT INTO entries (user_id, message, embedding, color, shape, x, y)
      VALUES (
        ${userId},
        ${message},
        ${embeddingLiteral}::vector,
        ${color},
        ${shape},
        ${x},
        ${y}
      )
    `;
    return true;
  } catch (err) {
    console.error(
      `  failed [${index + 1}] "${message.slice(0, 40)}": ${(err as Error).message}`,
    );
    return false;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function seed() {
  console.log('Seeding Echo database...\n');

  // Clear existing data
  console.log('Clearing existing entries and resonances...');
  await sql`DELETE FROM resonances`;
  await sql`DELETE FROM entries`;
  console.log('Cleared.\n');

  // Gemini free tier: 15 RPM = one request every 4 seconds.
  // We process sequentially and ensure each entry takes at least MIN_INTERVAL ms.
  // If the API call itself is slower, we move on immediately — no extra wait.
  const MIN_INTERVAL = 4000;
  let succeeded = 0;

  for (let i = 0; i < MESSAGES.length; i++) {
    const start = Date.now();

    const ok = await seedEntry(MESSAGES[i], i);
    if (ok) succeeded++;

    if ((i + 1) % 10 === 0 || i === MESSAGES.length - 1) {
      console.log(`Seeded ${i + 1}/${MESSAGES.length} entries...`);
    }

    // Sleep only the remaining time needed to reach MIN_INTERVAL
    if (i < MESSAGES.length - 1) {
      const wait = MIN_INTERVAL - (Date.now() - start);
      if (wait > 0) await sleep(wait);
    }
  }

  console.log(`\nDone. ${succeeded}/${MESSAGES.length} entries inserted.`);
  process.exit(0);
}

seed().catch(err => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
