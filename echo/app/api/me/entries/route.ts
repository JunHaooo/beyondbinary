import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

// Fields returned to the client — intentionally excludes embedding, x, y, user_id
interface JournalEntry {
  id: string;
  message: string;
  color: string;
  shape: string;
  intensity: number | null;
  category: string | null;
  created_at: string;
  resonance_count: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId') ?? searchParams.get('user_id');

  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }

  if (!UUID_RE.test(userId)) {
    return NextResponse.json({ error: 'Invalid userId' }, { status: 400 });
  }

  try {
    const entries = (await sql`
      SELECT
        e.id,
        e.message,
        e.color,
        e.shape,
        e.intensity,
        e.category,
        e.created_at,
        COUNT(r.id)::int AS resonance_count
      FROM entries e
      LEFT JOIN resonances r ON r.target_entry_id = e.id
      WHERE e.user_id = ${userId}
      GROUP BY e.id
      ORDER BY e.created_at DESC
    `) as JournalEntry[];

    return NextResponse.json(entries);
  } catch (err) {
    console.error('[GET /api/me/entries]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
