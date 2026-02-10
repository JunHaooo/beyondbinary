'use client';

import { useRef, useEffect, useState } from 'react';
import type { Entry } from '@/lib/types';
import { drawSmooth, drawSpiky, drawJagged, seedFromId } from '@/lib/shapes';
import { getUserId } from '@/lib/user';

// ── Similar Moments types ─────────────────────────────────────────────────────

interface SimilarMoment {
  id: string;
  message: string;
  created_at: string;
  distance: number;
}

interface SimilarPanel {
  blob: Entry;
  moments: SimilarMoment[];
  loading: boolean;
}

function timeAgo(dateStr: string): string {
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7)  return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks === 1) return '1 week ago';
  if (weeks < 5)  return `${weeks} weeks ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? '1 month ago' : `${months} months ago`;
}

// Coordinate reference space — blobs are stored in this space
const REF_W = 800;
const REF_H = 600;
// Hit-test radius in reference coords (generous for mobile)
const HIT_RADIUS = 26;
// Visual blob radius in reference coords
const BLOB_RADIUS = 18;
// How long the similarity glow lasts (ms)
const GLOW_DURATION = 3200;

// ─── Component ───────────────────────────────────────────────────────────────

export default function Mural() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // All canvas-driving state lives in refs so the RAF loop never goes stale
  const entriesRef = useRef<Entry[]>([]);
  const userIdRef = useRef<string | null>(null);
  const highlightedRef = useRef<string | null>(null);
  /** id → timestamp when glow started */
  const glowMapRef = useRef<Map<string, number>>(new Map());
  const lastTapRef = useRef<{ id: string; time: number } | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [similarPanel, setSimilarPanel] = useState<SimilarPanel | null>(null);
  const [panelVisible, setPanelVisible] = useState(false);

  // Animate panel in/out
  useEffect(() => {
    if (similarPanel) requestAnimationFrame(() => setPanelVisible(true));
    else setPanelVisible(false);
  }, [similarPanel]);

  // Fetch initial entries
  useEffect(() => {
    fetch('/api/stream')
      .then((r) => {
        if (!r.ok) throw new Error('stream failed');
        return r.json();
      })
      .then((data: Entry[]) => {
        entriesRef.current = data;
        setLoading(false);
      })
      .catch(() => {
        setError('Could not load the mural.');
        setLoading(false);
      });
  }, []);

  // Canvas setup, RAF loop, event listeners — initialised once on mount
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // ── Sizing ──────────────────────────────────────────────────────────────
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvas.offsetWidth * dpr;
      canvas.height = canvas.offsetHeight * dpr;
    };
    resize();
    window.addEventListener('resize', resize);

    userIdRef.current = getUserId();

    // ── Draw loop ───────────────────────────────────────────────────────────
    let animId: number;

    const draw = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const cssW = canvas.offsetWidth;
      const cssH = canvas.offsetHeight;
      if (cssW === 0 || cssH === 0) {
        animId = requestAnimationFrame(draw);
        return;
      }

      const scaleX = cssW / REF_W;
      const scaleY = cssH / REF_H;
      const blobR = BLOB_RADIUS * Math.min(scaleX, scaleY);
      const now = Date.now();

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.scale(dpr, dpr); // draw in CSS-pixel space from here on

      // Background
      ctx.fillStyle = '#0a0a0f';
      ctx.fillRect(0, 0, cssW, cssH);

      for (const entry of entriesRef.current) {
        const x = entry.x * scaleX;
        const y = entry.y * scaleY;
        const isHighlighted = highlightedRef.current === entry.id;
        const isOwnBlob =
          !!entry.user_id && entry.user_id === userIdRef.current;
        const glowStart = glowMapRef.current.get(entry.id);
        const glowAge = glowStart !== undefined ? now - glowStart : -1;
        const isGlowing = glowAge >= 0 && glowAge < GLOW_DURATION;

        // Expire finished glows
        if (glowAge >= GLOW_DURATION) glowMapRef.current.delete(entry.id);

        ctx.save();

        if (isHighlighted) {
          ctx.shadowColor = '#ffffff';
          ctx.shadowBlur = 24;
          ctx.fillStyle = entry.color;
        } else if (isGlowing) {
          const t = glowAge / GLOW_DURATION;
          // 3 quick pulses that fade out
          const pulse = Math.max(0, Math.sin(t * Math.PI * 3) * (1 - t));
          ctx.shadowColor = entry.color;
          ctx.shadowBlur = 22 * pulse;
          ctx.fillStyle = entry.color + 'bb';
        } else if (isOwnBlob) {
          ctx.shadowBlur = 0;
          ctx.fillStyle = entry.color; // full opacity for own blobs
        } else {
          ctx.shadowBlur = 0;
          ctx.fillStyle = entry.color + '88';
        }

        const seed = seedFromId(entry.id);
        switch (entry.shape) {
          case 'smooth':
            drawSmooth(ctx, x, y, blobR);
            break;
          case 'spiky':
            drawSpiky(ctx, x, y, blobR);
            break;
          case 'jagged':
            drawJagged(ctx, x, y, blobR, seed);
            break;
          default:
            drawSmooth(ctx, x, y, blobR);
        }

        // White ring around the current user's blob
        if (isOwnBlob) {
          ctx.shadowBlur = 0;
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(x, y, blobR + 4, 0, Math.PI * 2);
          ctx.stroke();
        }

        ctx.restore();
      }

      ctx.restore();
      animId = requestAnimationFrame(draw);
    };

    animId = requestAnimationFrame(draw);

    // ── Shared helpers ──────────────────────────────────────────────────────

    /** Convert a CSS-pixel canvas position to reference coords */
    const toRef = (cssX: number, cssY: number) => ({
      rx: cssX * (REF_W / canvas.offsetWidth),
      ry: cssY * (REF_H / canvas.offsetHeight),
    });

    /** Find the topmost blob within HIT_RADIUS of (rx, ry) in ref space */
    const findBlob = (rx: number, ry: number): Entry | null => {
      for (let i = entriesRef.current.length - 1; i >= 0; i--) {
        const e = entriesRef.current[i];
        if (Math.hypot(e.x - rx, e.y - ry) <= HIT_RADIUS) return e;
      }
      return null;
    };

    /** Highlight a blob and either show similar moments (own) or glow neighbours (others) */
    const handleSelect = async (blob: Entry) => {
      const isOwnBlob = !!blob.user_id && blob.user_id === userIdRef.current;

      // Toggle off if already selected
      if (highlightedRef.current === blob.id) {
        highlightedRef.current = null;
        glowMapRef.current.clear();
        setSimilarPanel(null);
        return;
      }
      highlightedRef.current = blob.id;
      glowMapRef.current.clear();

      if (isOwnBlob) {
        // Show "Similar Moments" panel from the user's own history
        setSimilarPanel({ blob, moments: [], loading: true });
        try {
          const res = await fetch(
            `/api/me/similar?entryId=${blob.id}&userId=${blob.user_id}`,
          );
          if (!res.ok) {
            setSimilarPanel((prev) => (prev ? { ...prev, loading: false } : null));
            return;
          }
          const moments: SimilarMoment[] = await res.json();
          setSimilarPanel((prev) =>
            prev ? { ...prev, moments, loading: false } : null,
          );
        } catch {
          setSimilarPanel((prev) => (prev ? { ...prev, loading: false } : null));
        }
      } else {
        // Existing behaviour: glow semantically similar blobs from all users
        setSimilarPanel(null);
        try {
          const res = await fetch(`/api/stream?entry_id=${blob.id}`);
          if (!res.ok) return;
          const similar: Entry[] = await res.json();
          const ts = Date.now();
          for (const s of similar) {
            if (s.id !== blob.id) glowMapRef.current.set(s.id, ts);
          }
        } catch {
          // Fail silently — highlight still works, glow just won't appear
        }
      }
    };

    /** Record a resonance and trigger a glow burst */
    const handleResonate = async (targetId: string) => {
      const actorId = getUserId();
      glowMapRef.current.set(targetId, Date.now()); // optimistic glow
      try {
        await fetch('/api/resonate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target_id: targetId, actor_id: actorId }),
        });
      } catch {
        // Fail silently
      }
    };

    // ── Event listeners ─────────────────────────────────────────────────────

    const handleClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const { rx, ry } = toRef(e.clientX - rect.left, e.clientY - rect.top);
      const blob = findBlob(rx, ry);
      if (blob) handleSelect(blob);
    };

    const handleDblClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const { rx, ry } = toRef(e.clientX - rect.left, e.clientY - rect.top);
      const blob = findBlob(rx, ry);
      if (blob) handleResonate(blob.id);
    };

    const handleTouchEnd = (e: TouchEvent) => {
      const touch = e.changedTouches[0];
      const rect = canvas.getBoundingClientRect();
      const { rx, ry } = toRef(
        touch.clientX - rect.left,
        touch.clientY - rect.top,
      );
      const blob = findBlob(rx, ry);
      if (!blob) return;

      const now = Date.now();
      const last = lastTapRef.current;
      if (last && last.id === blob.id && now - last.time < 350) {
        e.preventDefault(); // suppress the synthetic click that would follow
        handleResonate(blob.id);
        lastTapRef.current = null;
      } else {
        lastTapRef.current = { id: blob.id, time: now };
        // Single tap: let the synthetic click fire and call handleSelect
      }
    };

    canvas.addEventListener('click', handleClick);
    canvas.addEventListener('dblclick', handleDblClick);
    canvas.addEventListener('touchend', handleTouchEnd, { passive: false });

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('click', handleClick);
      canvas.removeEventListener('dblclick', handleDblClick);
      canvas.removeEventListener('touchend', handleTouchEnd);
    };
  }, []); // runs once — all mutable state is in refs

  return (
    <div className="relative w-full h-screen bg-[#0a0a0f] overflow-hidden">
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        style={{ touchAction: 'none' }}
      />

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <p className="text-white/30 text-xs tracking-[0.3em] uppercase">
            loading
          </p>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <p className="text-red-400/50 text-sm">{error}</p>
        </div>
      )}

      {/* ── Similar Moments bottom sheet ───────────────────────────────────── */}
      {similarPanel && (
        <div
          className="absolute inset-0 z-20"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSimilarPanel(null);
          }}
        >
          <div
            className={`absolute bottom-0 left-0 right-0
                        bg-[#0d0d18]/96 backdrop-blur-md
                        border-t border-white/[0.07] rounded-t-2xl
                        transition-transform duration-300 ease-out
                        ${panelVisible ? 'translate-y-0' : 'translate-y-full'}`}
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-8 h-0.5 bg-white/15 rounded-full" />
            </div>

            <div className="px-6 pt-3 pb-10 max-h-[58vh] overflow-y-auto">
              {/* Header */}
              <div className="flex items-start justify-between mb-5">
                <div className="flex-1 pr-4">
                  <p className="text-white/30 text-xs tracking-widest uppercase mb-2">
                    You&apos;ve felt this before
                  </p>
                  <p className="text-white/65 text-sm italic leading-snug line-clamp-3">
                    &ldquo;{similarPanel.blob.message}&rdquo;
                  </p>
                </div>
                <button
                  onClick={() => setSimilarPanel(null)}
                  className="text-white/30 text-2xl leading-none hover:text-white/60 transition-colors mt-0.5 shrink-0"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>

              {/* Loading */}
              {similarPanel.loading && (
                <p className="text-white/20 text-xs tracking-widest animate-pulse py-2">
                  searching your echoes...
                </p>
              )}

              {/* No similar results */}
              {!similarPanel.loading && similarPanel.moments.length === 0 && (
                <p className="text-white/30 text-sm leading-relaxed py-2">
                  No similar moments found yet. Keep echoing.
                </p>
              )}

              {/* Moments list */}
              {!similarPanel.loading && similarPanel.moments.length > 0 && (
                <>
                  <div className="flex flex-col gap-3 mb-5">
                    {similarPanel.moments.map((m) => (
                      <div
                        key={m.id}
                        className="border-l-2 border-white/[0.12] pl-3"
                      >
                        <p className="text-white/55 text-sm leading-snug line-clamp-2">
                          {m.message}
                        </p>
                        <p className="text-white/20 text-xs mt-1">
                          {timeAgo(m.created_at)}
                        </p>
                      </div>
                    ))}
                  </div>

                  <p className="text-white/25 text-xs italic leading-relaxed pt-4 border-t border-white/[0.06]">
                    This feeling comes and goes. You&apos;ve moved through it before.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
