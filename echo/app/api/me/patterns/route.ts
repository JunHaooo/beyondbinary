import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Timeframe = 'week' | 'month' | 'all';

function minDateFor(timeframe: Timeframe): string {
  if (timeframe === 'week')  return new Date(Date.now() - 7  * 86_400_000).toISOString();
  if (timeframe === 'month') return new Date(Date.now() - 30 * 86_400_000).toISOString();
  return '1970-01-01T00:00:00.000Z'; // 'all'
}

const EMPTY_RESPONSE = {
  total_entries: 0,
  entries_per_day: [],
  category_breakdown: {},
  shape_distribution: {},
  peak_day: null,
  peak_hour: null,
  avg_intensity: null,
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId   = searchParams.get('userId') ?? searchParams.get('user_id');
  const tfParam  = searchParams.get('timeframe') ?? 'week';
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
    // ── Total entries + global avg_intensity ─────────────────────────────────
    const [totals] = await sql`
      SELECT
        COUNT(*)::int        AS total_entries,
        AVG(intensity)::float AS avg_intensity
      FROM entries
      WHERE user_id = ${userId}
        AND created_at >= ${minDate}
    ` as { total_entries: number; avg_intensity: number | null }[];

    if (totals.total_entries === 0) {
      return NextResponse.json(EMPTY_RESPONSE);
    }

    // ── Entries per day ───────────────────────────────────────────────────────
    const entriesPerDay = await sql`
      SELECT
        DATE_TRUNC('day', created_at)::date::text AS date,
        COUNT(*)::int                             AS count,
        AVG(intensity)::float                     AS avg_intensity
      FROM entries
      WHERE user_id = ${userId}
        AND created_at >= ${minDate}
      GROUP BY DATE_TRUNC('day', created_at)
      ORDER BY date DESC
    ` as { date: string; count: number; avg_intensity: number | null }[];

    // ── Category breakdown ────────────────────────────────────────────────────
    const categoryRaw = await sql`
      SELECT category, COUNT(*)::int AS count
      FROM entries
      WHERE user_id = ${userId}
        AND created_at >= ${minDate}
        AND category IS NOT NULL
      GROUP BY category
    ` as { category: string; count: number }[];

    const category_breakdown = Object.fromEntries(
      categoryRaw.map(r => [r.category, r.count])
    ) as Record<string, number>;

    // ── Shape distribution ────────────────────────────────────────────────────
    const shapeRaw = await sql`
      SELECT shape, COUNT(*)::int AS count
      FROM entries
      WHERE user_id = ${userId}
        AND created_at >= ${minDate}
        AND shape IS NOT NULL
      GROUP BY shape
    ` as { shape: string; count: number }[];

    const shape_distribution = Object.fromEntries(
      shapeRaw.map(r => [r.shape, r.count])
    ) as Record<string, number>;

    // ── Peak day of week ──────────────────────────────────────────────────────
    const peakDayRaw = await sql`
      SELECT
        TO_CHAR(created_at, 'FMDay') AS day_name,
        COUNT(*)::int                AS count
      FROM entries
      WHERE user_id = ${userId}
        AND created_at >= ${minDate}
      GROUP BY TO_CHAR(created_at, 'FMDay'), EXTRACT(DOW FROM created_at)
      ORDER BY count DESC
      LIMIT 1
    ` as { day_name: string }[];

    const peak_day = peakDayRaw[0]?.day_name?.trim() ?? null;

    // ── Peak hour of day ──────────────────────────────────────────────────────
    const peakHourRaw = await sql`
      SELECT
        EXTRACT(HOUR FROM created_at)::int AS hour,
        COUNT(*)::int                      AS count
      FROM entries
      WHERE user_id = ${userId}
        AND created_at >= ${minDate}
      GROUP BY EXTRACT(HOUR FROM created_at)
      ORDER BY count DESC
      LIMIT 1
    ` as { hour: number }[];

    const peak_hour = peakHourRaw[0]?.hour ?? null;

    return NextResponse.json({
      total_entries:      totals.total_entries,
      entries_per_day:    entriesPerDay,
      category_breakdown,
      shape_distribution,
      peak_day,
      peak_hour,
      avg_intensity:      totals.avg_intensity !== null
        ? Math.round(totals.avg_intensity * 10) / 10
        : null,
    });
  } catch (err) {
    console.error('[GET /api/me/patterns]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
