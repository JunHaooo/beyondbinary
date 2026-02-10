import { NextRequest, NextResponse } from 'next/server';
import { analyseEntry } from '@/lib/ai';
import { sql } from '@/lib/db';
import type { Entry } from '@/lib/types';

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const text: string = body?.text;
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const rawUserId = body?.user_id;
    const user_id: string | null =
      typeof rawUserId === 'string' && UUID_RE.test(rawUserId) ? rawUserId : null;

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return NextResponse.json({ error: 'text is required' }, { status: 400 });
    }

    if (text.length > 284) {
      return NextResponse.json({ error: 'text exceeds 284 characters' }, { status: 400 });
    }

    const analysis = await analyseEntry(text.trim());

    const x = Math.floor(Math.random() * CANVAS_WIDTH);
    const y = Math.floor(Math.random() * CANVAS_HEIGHT);

    // Pass embedding as a Postgres vector literal: '[n1,n2,...]'::vector
    const embeddingLiteral = `[${analysis.embedding.join(',')}]`;

    const rows = (await sql`
      INSERT INTO entries (user_id, message, embedding, color, shape, intensity, category, x, y)
      VALUES (
        ${user_id},
        ${text.trim()},
        ${embeddingLiteral}::vector,
        ${analysis.color},
        ${analysis.shape},
        ${analysis.intensity},
        ${analysis.category},
        ${x},
        ${y}
      )
      RETURNING id, color, shape, intensity, category, x, y
    `) as Entry[];

    return Response.json({
      id: rows[0].id,
      color: rows[0].color,
      shape: rows[0].shape,
      x: rows[0].x,
      y: rows[0].y,
      intensity: rows[0].intensity,
      category: rows[0].category,
    });
  } catch (err) {
    console.error('[POST /api/entry]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
