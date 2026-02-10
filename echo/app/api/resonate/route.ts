import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import type { Resonance } from '@/lib/types';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { target_id, actor_id } = body ?? {};

    if (!target_id || typeof target_id !== 'string') {
      return NextResponse.json({ error: 'target_id is required' }, { status: 400 });
    }
    if (!actor_id || typeof actor_id !== 'string') {
      return NextResponse.json({ error: 'actor_id is required' }, { status: 400 });
    }

    const rows = (await sql`
      INSERT INTO resonances (target_entry_id, actor_entry_id)
      VALUES (${target_id}, ${actor_id})
      RETURNING id, target_entry_id, actor_entry_id, created_at
    `) as Resonance[];

    return NextResponse.json({ success: true, resonance: rows[0] }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/resonate]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
