import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import type { Entry } from '@/lib/types';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const entryId = searchParams.get('entry_id');

  try {
    if (entryId) {
      // Cosine similarity search via pgvector <=> operator.
      // Uses a CTE so the target embedding is looked up once.
      // Distance threshold < 0.4 keeps only genuinely similar entries
      // (cosine distance 0 = identical, 2 = opposite for normalised vectors).
      const similar = (await sql`
        WITH target AS (
          SELECT embedding FROM entries WHERE id = ${entryId}
        )
        SELECT e.id, e.user_id, e.message, e.color, e.shape, e.x, e.y, e.created_at,
          (1 - (e.embedding <=> t.embedding)) AS similarity
        FROM entries e
        CROSS JOIN target t
        WHERE e.id != ${entryId}
          AND e.embedding IS NOT NULL
          AND (e.embedding <=> t.embedding) < 0.5
        ORDER BY e.embedding <=> t.embedding
        LIMIT 8
      `);
      return NextResponse.json(similar);
    }

    const entries = (await sql`
      SELECT id, user_id, message, color, shape, x, y, created_at
      FROM entries
      ORDER BY created_at DESC
      LIMIT 50
    `) as Entry[];
    return NextResponse.json(entries);
  } catch (err) {
    console.error('[GET /api/stream]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
