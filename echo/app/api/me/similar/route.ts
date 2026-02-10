import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface SimilarEntry {
  id: string;
  message: string;
  created_at: string;
  distance: number;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const entryId = searchParams.get('entryId');
  const userId  = searchParams.get('userId');

  if (!entryId || !userId) {
    return NextResponse.json(
      { error: 'entryId and userId are required' },
      { status: 400 },
    );
  }
  if (!UUID_RE.test(entryId) || !UUID_RE.test(userId)) {
    return NextResponse.json({ error: 'Invalid UUID' }, { status: 400 });
  }

  try {
    // CTE fetches the target embedding once; we filter to the same user only,
    // excluding the entry itself. Only returns entries with cosine distance < 0.5
    // to ensure genuine semantic similarity.
    const similar = (await sql`
      WITH target AS (
        SELECT embedding
        FROM entries
        WHERE id = ${entryId}
          AND user_id = ${userId}
      )
      SELECT
        e.id,
        e.message,
        e.created_at,
        (e.embedding <=> t.embedding)::float AS distance
      FROM entries e
      CROSS JOIN target t
      WHERE e.user_id = ${userId}
        AND e.id        != ${entryId}
        AND e.embedding IS NOT NULL
        AND (e.embedding <=> t.embedding) < 0.5
      ORDER BY e.embedding <=> t.embedding
      LIMIT 5
    `) as SimilarEntry[];

    return NextResponse.json(similar);
  } catch (err) {
    console.error('[GET /api/me/similar]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
