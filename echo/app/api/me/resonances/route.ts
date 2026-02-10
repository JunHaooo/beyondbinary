import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import type { Entry } from '@/lib/types';

export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get('userId');
    
    if (!userId || typeof userId !== 'string') {
      return NextResponse.json({ error: 'userId query param required' }, { status: 400 });
    }
    
    // Fetch resonances where the target entry belongs to the current user
    // within the last 10 seconds (to avoid re-glowing the same resonance)
    const now = new Date();
    const tenSecondsAgo = new Date(now.getTime() - 10000);

    const rows = (await sql`
      SELECT r.target_entry_id, e.id, e.user_id, e.message, e.color, e.shape, e.intensity, e.category, e.x, e.y, e.created_at
      FROM resonances r
      JOIN entries e ON r.target_entry_id = e.id
      WHERE e.user_id = ${userId}
        AND r.created_at > ${tenSecondsAgo}
      ORDER BY r.created_at DESC
      LIMIT 20
    `) as (Entry & { target_entry_id: string })[];

    return NextResponse.json(rows, { status: 200 });
  } catch (err) {
    console.error('[GET /api/me/resonances]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
