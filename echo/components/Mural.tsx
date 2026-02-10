'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
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
// How long the resonance pulse lasts (ms)
const GLOW_DURATION = 4500;

// ─── Component ───────────────────────────────────────────────────────────────

export default function Mural() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // All canvas-driving state lives in refs so the RAF loop never goes stale
  const entriesRef = useRef<Entry[]>([]);
  const userIdRef = useRef<string | null>(null);
  const highlightedRef = useRef<string | null>(null);
  /** id → timestamp when resonance glow started (scales + pulses) */
  const glowMapRef = useRef<Map<string, number>>(new Map());
  /** id → timestamp when similarity glow started (just glow, no scaling) */
  const similarityGlowMapRef = useRef<Map<string, number>>(new Map());
  const lastTapRef = useRef<{ id: string; time: number } | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [similarPanel, setSimilarPanel] = useState<SimilarPanel | null>(null);
  const [panelVisible, setPanelVisible] = useState(false);

  // Record a resonance and trigger a glow burst
  const handleResonate = useCallback(async (targetId: string) => {
    const actorId = getUserId();
    const now = Date.now();
    
    // Glow the target blob on the other user's screen
    glowMapRef.current.set(targetId, now);
    
    try {
      await fetch('/api/resonate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_id: targetId, actor_id: actorId }),
      });
    } catch {
      // Fail silently
    }
  }, []);

  // Highlight a blob and either show similar moments (own) or open resonate panel (others)
  const handleSelect = useCallback(async (blob: Entry) => {
    const isOwnBlob = !!blob.user_id && blob.user_id === userIdRef.current;

    // Toggle off if already selected
    if (highlightedRef.current === blob.id) {
      highlightedRef.current = null;
      glowMapRef.current.clear();
      similarityGlowMapRef.current.clear();
      setSimilarPanel(null);
      return;
    }
    highlightedRef.current = blob.id;
    glowMapRef.current.clear();
    similarityGlowMapRef.current.clear();

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
      
      // Also fetch and glow semantically similar blobs (from any user)
      try {
        console.log('[handleSelect] Fetching semantic similar blobs for own blob:', blob.id);
        const res = await fetch(`/api/stream?entry_id=${blob.id}`);
        if (!res.ok) {
          console.log('[handleSelect] Fetch failed with status:', res.status);
          return;
        }
        const similar: Entry[] = await res.json();
        console.log('[handleSelect] Got semantic similar blobs:', similar.length, similar);
        const ts = Date.now();
        for (const s of similar) {
          if (s.id !== blob.id) {
            console.log('[handleSelect] Setting similarity glow for:', s.id);
            similarityGlowMapRef.current.set(s.id, ts);
          }
        }
      } catch (err) {
        console.error('[handleSelect] Fetch error:', err);
      }
    } else {
      // Show resonate option for other people's blobs
      setSimilarPanel({ blob, moments: [], loading: false });
      
      // Fetch and glow semantically similar blobs
      try {
        console.log('[handleSelect] Fetching similar blobs for:', blob.id);
        const res = await fetch(`/api/stream?entry_id=${blob.id}`);
        if (!res.ok) {
          console.log('[handleSelect] Fetch failed with status:', res.status);
          return;
        }
        const similar: Entry[] = await res.json();
        console.log('[handleSelect] Got similar blobs:', similar.length, similar);
        const ts = Date.now();
        for (const s of similar) {
          if (s.id !== blob.id) {
            console.log('[handleSelect] Setting similarity glow for:', s.id);
            similarityGlowMapRef.current.set(s.id, ts);
          }
        }
      } catch (err) {
        console.error('[handleSelect] Fetch error:', err);
      }
    }
  }, []);

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

  // Poll for recent resonances to show incoming pulses
  useEffect(() => {
    const pollResonate = async () => {
      const userId = userIdRef.current;
      if (!userId) return;
      
      try {
        const res = await fetch(`/api/me/resonances?userId=${userId}`);
        if (!res.ok) return;
        const resonances: Array<{ target_entry_id: string }> = await res.json();
        const now = Date.now();
        for (const r of resonances) {
          // Only glow if not already glowing or recently glowed
          if (!glowMapRef.current.has(r.target_entry_id)) {
            glowMapRef.current.set(r.target_entry_id, now);
          }
        }
      } catch {
        // Fail silently
      }
    };

    const interval = setInterval(pollResonate, 2000);
    return () => clearInterval(interval);
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

        const similarityGlowStart = similarityGlowMapRef.current.get(entry.id);
        const similarityGlowAge = similarityGlowStart !== undefined ? now - similarityGlowStart : -1;
        const isSimilarityGlowing = similarityGlowAge >= 0 && similarityGlowAge < GLOW_DURATION;

        // Expire finished glows
        if (glowAge >= GLOW_DURATION) glowMapRef.current.delete(entry.id);
        if (similarityGlowAge >= GLOW_DURATION) similarityGlowMapRef.current.delete(entry.id);

        ctx.save();

        // Calculate radius with pulse effect only for resonance glows (not similarity)
        let drawRadius = blobR;
        if (isGlowing) {
          const t = glowAge / GLOW_DURATION;
          // Size pulse: continuous oscillation that fades out (no pause)
          const sizePulse = Math.abs(Math.sin(t * Math.PI * 5)) * (1 - t);
          drawRadius = blobR * (1 + 0.35 * sizePulse); // scale from 1x to 1.35x size
        }

        if (isHighlighted) {
          ctx.shadowColor = '#ffffff';
          ctx.shadowBlur = 24;
          ctx.fillStyle = entry.color;
        } else if (isGlowing) {
          const t = glowAge / GLOW_DURATION;
          // Resonance pulse: continuous oscillation that fades out (no pause)
          const pulse = Math.abs(Math.sin(t * Math.PI * 5)) * (1 - t);
          ctx.shadowColor = entry.color;
          ctx.shadowBlur = 22 * pulse;
          ctx.fillStyle = entry.color + 'bb';
        } else if (isSimilarityGlowing) {
          const t = similarityGlowAge / GLOW_DURATION;
          // Similarity glow: soft glow that fades out, no pulsing
          ctx.shadowColor = entry.color;
          ctx.shadowBlur = 18 * (1 - t); // fade out over time
          ctx.fillStyle = entry.color + 'aa'; // slightly transparent
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
            drawSmooth(ctx, x, y, drawRadius);
            break;
          case 'spiky':
            drawSpiky(ctx, x, y, drawRadius);
            break;
          case 'jagged':
            drawJagged(ctx, x, y, drawRadius, seed);
            break;
          default:
            drawSmooth(ctx, x, y, drawRadius);
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

    const handleDblClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const { rx, ry } = toRef(e.clientX - rect.left, e.clientY - rect.top);
      const blob = findBlob(rx, ry);
      if (blob) handleResonate(blob.id);
    };

    const handleClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const { rx, ry } = toRef(e.clientX - rect.left, e.clientY - rect.top);
      const blob = findBlob(rx, ry);
      if (blob) handleSelect(blob);
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

      {/* ── Similar Moments / Resonate Panel ────────────────────────────────────── */}
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
                    {similarPanel.moments.length > 0
                      ? "You've felt this before"
                      : 'Someone echoed'}
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

              {/* No similar results - only show for own blobs */}
              {!similarPanel.loading && similarPanel.moments.length === 0 && similarPanel.blob.user_id === userIdRef.current && (
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

              {/* Resonate button for other people's blobs */}
              {!similarPanel.loading && similarPanel.moments.length === 0 && similarPanel.blob.user_id && similarPanel.blob.user_id !== userIdRef.current && (
                <button
                  onClick={() => handleResonate(similarPanel.blob.id)}
                  className="w-full mt-6 px-4 py-2.5 
                           bg-white/10 hover:bg-white/20 
                           text-white/70 hover:text-white
                           border border-white/[0.15] hover:border-white/30
                           rounded-lg transition-all duration-200
                           text-sm font-medium tracking-wide
                           active:scale-95"
                >
                  Resonate
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Helper text */}
      <div className="absolute bottom-6 left-6 pointer-events-none">
        {similarPanel && !similarPanel.blob.user_id || similarPanel?.blob.user_id !== userIdRef.current ? (
          <p className="text-white/40 text-xs leading-relaxed max-w-xs">
            blobs with outlines are yours • click to read others' echoes • double tap to resonate
          </p>
        ) : (
          <p className="text-white/40 text-xs leading-relaxed max-w-xs">
            blobs with outlines are yours • click to read others' echoes
          </p>
        )}
      </div>
    </div>
  );
}
