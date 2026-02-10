import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { sql } from '@/lib/db';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Timeframe = 'week' | 'month' | 'all';

function minDateFor(timeframe: Timeframe): string {
  if (timeframe === 'week')  return new Date(Date.now() - 7  * 86_400_000).toISOString();
  if (timeframe === 'month') return new Date(Date.now() - 30 * 86_400_000).toISOString();
  return '1970-01-01T00:00:00.000Z';
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const userId    = body?.userId ?? body?.user_id;
  const tfParam   = body?.timeframe ?? 'week';
  const timeframe: Timeframe = ['week', 'month', 'all'].includes(tfParam)
    ? (tfParam as Timeframe)
    : 'week';

  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }
  if (!UUID_RE.test(userId)) {
    return NextResponse.json({ error: 'Invalid userId' }, { status: 400 });
  }

  const minDate = minDateFor(timeframe);

  try {
    // Fetch the user's messages in the timeframe
    const rows = await sql`
      SELECT message
      FROM entries
      WHERE user_id = ${userId}
        AND created_at >= ${minDate}
      ORDER BY created_at DESC
      LIMIT 30
    ` as { message: string }[];

    if (rows.length < 2) {
      return NextResponse.json({
        insight: null,
        reason: 'not_enough_entries',
      });
    }

    const messages = rows.map(r => r.message);

    const prompt = `You are a gentle, observant friend. Based on these emotional expressions from the past week:

${messages.map((m, i) => `${i + 1}. "${m}"`).join('\n')}

Write a warm 2-3 sentence reflection in second person. Focus on patterns you notice, not judgment. Tone: kind, observant, validating. Avoid clinical language or prescriptive advice. Write only the reflection, no preamble.`;

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const result = await model.generateContent(prompt);
    const insight = result.response.text().trim();

    return NextResponse.json({ insight });
  } catch (err) {
    console.error('[POST /api/me/insight]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
