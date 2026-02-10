'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { getUserId } from '@/lib/user';
import BlobPreview from '@/components/BlobPreview';

// ── Types ─────────────────────────────────────────────────────────────────────

interface JournalEntry {
  id: string;
  message: string;
  color: string;
  shape: 'spiky' | 'smooth' | 'jagged';
  intensity: number | null;
  category: string | null;
  created_at: string;
  resonance_count: number;
}

interface EntriesPerDay {
  date: string;
  count: number;
  avg_intensity: number | null;
}

interface DistItem {
  name: string;
  count: number;
  percentage: number;
}

interface PatternsData {
  total_entries: number;
  entries_per_day: EntriesPerDay[];
  category_breakdown: Record<string, number>;
  shape_distribution: Record<string, number>;
  peak_day: string | null;
  peak_hour: number | null;
  avg_intensity: number | null;
}

function hourToTimePeriod(hour: number): string {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

/** Convert Record<name, count> to DistItem[] sorted desc with percentages */
function toDistItems(breakdown: Record<string, number>): DistItem[] {
  const total = Object.values(breakdown).reduce((s, n) => s + n, 0);
  return Object.entries(breakdown)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({
      name,
      count,
      percentage: total > 0 ? Math.round((count / total) * 100) : 0,
    }));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function intensityToColor(avg: number | null): string {
  if (avg === null) return '#2a2a44';
  // interpolate blue (#4488ff) → red (#ff4444) across 1–10
  const t = Math.max(0, Math.min(1, (avg - 1) / 9));
  const r = Math.round(0x44 + (0xff - 0x44) * t);
  const g = Math.round(0x88 * (1 - t));
  const b = Math.round(0xff + (0x44 - 0xff) * t);
  return `rgb(${r},${g},${b})`;
}

const SHAPE_COLORS: Record<string, string> = {
  smooth: '#4499ff',
  spiky:  '#ff6644',
  jagged: '#aa55ff',
};

const CATEGORY_COLORS: Record<string, string> = {
  work:          '#ffaa44',
  relationships: '#ff6688',
  self:          '#44bbaa',
};

// ── Time grouping ─────────────────────────────────────────────────────────────

type Group = { label: string; entries: JournalEntry[] };

function groupEntries(entries: JournalEntry[]): Group[] {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart.getTime() - 86_400_000);
  const weekStart = new Date(todayStart.getTime() - 7 * 86_400_000);

  const groups: Group[] = [
    { label: 'Today', entries: [] },
    { label: 'Yesterday', entries: [] },
    { label: 'This Week', entries: [] },
    { label: 'Earlier', entries: [] },
  ];

  for (const entry of entries) {
    const d = new Date(entry.created_at);
    if (d >= todayStart)          groups[0].entries.push(entry);
    else if (d >= yesterdayStart) groups[1].entries.push(entry);
    else if (d >= weekStart)      groups[2].entries.push(entry);
    else                          groups[3].entries.push(entry);
  }

  return groups.filter(g => g.entries.length > 0);
}

function formatTimestamp(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);

  const time = date
    .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    .toLowerCase()
    .replace(' ', '');

  if (date >= todayStart) return time;
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString('en-US', { day: 'numeric', month: 'short' }).toLowerCase();
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="flex flex-col gap-2">
      {[...Array(4)].map((_, i) => (
        <div
          key={i}
          className="h-[72px] rounded-xl bg-white/[0.04] animate-pulse"
          style={{ opacity: 1 - i * 0.15 }}
        />
      ))}
    </div>
  );
}

function PatternsSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      {[...Array(3)].map((_, i) => (
        <div key={i} className="flex flex-col gap-3">
          <div className="h-3 w-32 bg-white/[0.04] rounded animate-pulse" />
          <div className="h-20 bg-white/[0.04] rounded-xl animate-pulse" style={{ opacity: 1 - i * 0.2 }} />
        </div>
      ))}
    </div>
  );
}

// ── Entry card ────────────────────────────────────────────────────────────────

function EntryCard({ entry }: { entry: JournalEntry }) {
  const hasResonance = entry.resonance_count > 0;
  const resonanceLabel =
    entry.resonance_count === 1
      ? '1 person resonated'
      : `${entry.resonance_count} people resonated`;

  return (
    <div
      className="flex items-center gap-3 px-3 py-3 rounded-r-xl bg-white/[0.02] transition-shadow"
      style={{
        borderLeft: `3px solid ${entry.color}`,
        boxShadow: hasResonance ? `0 0 18px ${entry.color}22` : undefined,
      }}
    >
      <div className="shrink-0">
        <BlobPreview id={entry.id} color={entry.color} shape={entry.shape} size={48} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-white/70 text-sm leading-snug line-clamp-2">{entry.message}</p>
        {hasResonance && (
          <div className="flex items-center gap-1.5 mt-1.5">
            <span
              className="w-1.5 h-1.5 rounded-full animate-pulse"
              style={{ backgroundColor: entry.color + 'aa' }}
            />
            <span className="text-white/25 text-xs">{resonanceLabel}</span>
          </div>
        )}
      </div>
      <span className="shrink-0 text-white/25 text-xs tabular-nums self-start pt-0.5">
        {formatTimestamp(entry.created_at)}
      </span>
    </div>
  );
}

// ── Patterns sub-components ───────────────────────────────────────────────────

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-white/35 text-xs tracking-[0.25em] uppercase mb-4">{children}</p>
  );
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function WeeklyChart({ entriesPerDay }: { entriesPerDay: EntriesPerDay[] }) {
  // Zero-fill the last 7 days for the chart
  const now = new Date();
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (6 - i));
    const dateStr = d.toISOString().split('T')[0];
    const found = entriesPerDay.find(e => e.date === dateStr);
    return {
      label: DAY_LABELS[d.getDay()],
      date: dateStr,
      count: found?.count ?? 0,
      avg_intensity: found?.avg_intensity ?? null,
    };
  });

  const maxCount = Math.max(...days.map(d => d.count), 1);

  return (
    <div>
      <SectionHeading>Your Echo This Week</SectionHeading>
      <div className="flex items-end justify-between gap-1.5 h-20">
        {days.map(day => (
          <div key={day.date} className="flex flex-col items-center gap-1.5 flex-1">
            <div className="w-full flex items-end" style={{ height: 56 }}>
              <div
                className="w-full rounded-sm transition-all duration-500"
                style={{
                  height: day.count === 0 ? 3 : Math.max(6, (day.count / maxCount) * 56),
                  backgroundColor: intensityToColor(day.avg_intensity),
                  opacity: day.count === 0 ? 0.15 : 0.75,
                }}
              />
            </div>
            <span className="text-white/25 text-[10px]">{day.label}</span>
          </div>
        ))}
      </div>
      <p className="text-white/15 text-xs mt-3">
        intensity: <span style={{ color: intensityToColor(2) }}>low</span>
        {' → '}
        <span style={{ color: intensityToColor(10) }}>high</span>
      </p>
    </div>
  );
}

function DistributionBars({
  heading,
  items,
  colorMap,
}: {
  heading: string;
  items: DistItem[];
  colorMap: Record<string, string>;
}) {
  if (items.length === 0) {
    return (
      <div>
        <SectionHeading>{heading}</SectionHeading>
        <p className="text-white/20 text-xs">Not enough data yet.</p>
      </div>
    );
  }

  return (
    <div>
      <SectionHeading>{heading}</SectionHeading>
      <div className="flex flex-col gap-3">
        {items.map(item => (
          <div key={item.name}>
            <div className="flex justify-between items-baseline mb-1.5">
              <span className="text-white/50 text-xs capitalize">{item.name}</span>
              <span className="text-white/25 text-xs tabular-nums">
                {item.count}× · {item.percentage}%
              </span>
            </div>
            <div className="h-1 bg-white/[0.05] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${item.percentage}%`,
                  backgroundColor: colorMap[item.name] ?? '#888888',
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TemporalPatterns({
  peak_day,
  peak_hour,
}: {
  peak_day: string | null;
  peak_hour: number | null;
}) {
  const peak_time = peak_hour !== null ? hourToTimePeriod(peak_hour) : null;
  const hasData = peak_day || peak_time;

  return (
    <div>
      <SectionHeading>Temporal Patterns</SectionHeading>
      {!hasData ? (
        <p className="text-white/20 text-xs">Not enough data yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {peak_day && (
            <p className="text-white/45 text-sm leading-relaxed">
              You tend to echo most on{' '}
              <span className="text-white/70">{peak_day}s</span>.
            </p>
          )}
          {peak_time && (
            <p className="text-white/45 text-sm leading-relaxed">
              Most often in the{' '}
              <span className="text-white/70">{peak_time}</span>.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function AIReflection({
  insight,
  loading,
  onGenerate,
}: {
  insight: string | null;
  loading: boolean;
  onGenerate: () => void;
}) {
  // Fade in when insight first appears
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (insight) requestAnimationFrame(() => setVisible(true));
    else setVisible(false);
  }, [insight]);

  return (
    <div>
      <SectionHeading>AI Reflection</SectionHeading>

      {/* Idle — show generate button */}
      {!insight && !loading && (
        <button
          onClick={onGenerate}
          className="w-full py-3 rounded-xl border border-white/10 bg-white/[0.02]
                     text-white/40 text-xs tracking-widest uppercase
                     hover:text-white/60 hover:border-white/20
                     transition-all duration-200"
        >
          Generate Insight
        </button>
      )}

      {/* Loading */}
      {loading && (
        <div className="px-4 py-3 rounded-xl border border-white/[0.06] bg-white/[0.02]">
          <span className="text-white/25 text-xs tracking-widest animate-pulse">
            reflecting on your week...
          </span>
        </div>
      )}

      {/* Insight text */}
      {insight && (
        <div
          className={`px-4 py-4 rounded-xl border border-white/[0.08] bg-white/[0.03]
                      transition-opacity duration-700 ${visible ? 'opacity-100' : 'opacity-0'}`}
        >
          <p className="text-white/60 text-sm leading-relaxed italic">
            {insight}
          </p>
          <button
            onClick={onGenerate}
            className="mt-3 text-white/20 text-xs tracking-widest uppercase
                       hover:text-white/40 transition-colors"
          >
            regenerate
          </button>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = 'timeline' | 'patterns';

export default function MePage() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('timeline');

  const [patterns, setPatterns] = useState<PatternsData | null>(null);
  const [patternsLoading, setPatternsLoading] = useState(false);
  const [patternsFetched, setPatternsFetched] = useState(false);

  const [insight, setInsight] = useState<string | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);

  // Fetch timeline entries on mount
  useEffect(() => {
    const userId = getUserId();
    fetch(`/api/me/entries?userId=${userId}`)
      .then(r => r.json())
      .then((data: JournalEntry[]) => {
        setEntries(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Fetch patterns lazily when tab first switches
  useEffect(() => {
    if (tab !== 'patterns' || patternsFetched) return;
    setPatternsFetched(true);
    setPatternsLoading(true);
    const userId = getUserId();
    fetch(`/api/me/patterns?userId=${userId}`)
      .then(r => r.json())
      .then((data: PatternsData) => {
        setPatterns(data);
        setPatternsLoading(false);
      })
      .catch(() => setPatternsLoading(false));
  }, [tab, patternsFetched]);

  const handleGenerateInsight = async () => {
    if (insightLoading) return;
    setInsightLoading(true);
    const userId = getUserId();
    try {
      const res = await fetch('/api/me/insight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, timeframe: 'week' }),
      });
      const data = await res.json();
      setInsight(data.insight ?? null);
    } catch { /* silent */ } finally {
      setInsightLoading(false);
    }
  };

  const groups = groupEntries(entries);

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex flex-col">
      {/* Nav */}
      <div className="flex items-center justify-between px-6 pt-6 pb-4">
        <Link
          href="/mural"
          className="text-white/40 text-xs tracking-widest uppercase hover:text-white/60 transition-colors"
        >
          ← back
        </Link>
        <span className="text-white/40 text-xs tracking-[0.4em] uppercase">echo</span>
        <Link
          href="/"
          className="text-white/25 hover:text-white/50 transition-colors"
          aria-label="Home"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M7 1.5 L13 6.5 L13 13 L9 13 L9 9 L5 9 L5 13 L1 13 L1 6.5 Z" />
          </svg>
        </Link>
      </div>

      <div className="flex-1 w-full max-w-[600px] mx-auto px-6 pb-12">
        {/* Title */}
        <h1 className="text-white/80 text-xl font-light tracking-wide mb-6">
          Your Echoes
        </h1>

        {/* Tabs */}
        <div className="flex gap-6 mb-6 border-b border-white/[0.06]">
          {(['timeline', 'patterns'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`pb-3 text-xs tracking-widest uppercase transition-colors ${
                tab === t
                  ? 'text-white/70 border-b border-white/40 -mb-px'
                  : 'text-white/25 hover:text-white/40'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* ── Timeline ── */}
        {tab === 'timeline' && (
          <div className="transition-opacity duration-200">
            {loading && <Skeleton />}

            {!loading && entries.length === 0 && (
              <div className="flex flex-col items-center gap-5 pt-16 text-center">
                <p className="text-white/30 text-sm tracking-wide">
                  You haven&apos;t released any echoes yet.
                </p>
                <Link
                  href="/submit"
                  className="px-6 py-2.5 rounded-full border border-white/15
                             text-white/50 text-xs tracking-widest uppercase
                             hover:text-white/70 hover:border-white/30
                             transition-all bg-white/[0.02]"
                >
                  Release your first echo
                </Link>
              </div>
            )}

            {!loading && groups.length > 0 && (
              <div className="flex flex-col gap-6">
                {groups.map(group => (
                  <section key={group.label}>
                    <p className="text-white/20 text-xs tracking-[0.3em] uppercase mb-3">
                      {group.label}
                    </p>
                    <div className="flex flex-col gap-2">
                      {group.entries.map(entry => (
                        <EntryCard key={entry.id} entry={entry} />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Patterns ── */}
        {tab === 'patterns' && (
          <div className="transition-opacity duration-200">
            {patternsLoading && <PatternsSkeleton />}

            {!patternsLoading && patterns && (
              <div className="flex flex-col gap-10">
                <WeeklyChart entriesPerDay={patterns.entries_per_day} />

                <DistributionBars
                  heading="Recurring Themes"
                  items={toDistItems(patterns.category_breakdown)}
                  colorMap={CATEGORY_COLORS}
                />

                <DistributionBars
                  heading="Shape Distribution"
                  items={toDistItems(patterns.shape_distribution)}
                  colorMap={SHAPE_COLORS}
                />

                <TemporalPatterns
                  peak_day={patterns.peak_day}
                  peak_hour={patterns.peak_hour}
                />

                <AIReflection
                  insight={insight}
                  loading={insightLoading}
                  onGenerate={handleGenerateInsight}
                />
              </div>
            )}

            {!patternsLoading && !patterns && (
              <div className="pt-16 text-center">
                <p className="text-white/20 text-xs tracking-widest uppercase">
                  Could not load patterns.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
