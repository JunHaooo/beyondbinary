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
  /** Map of id -> animated display position / timeline info */
  const displayPosRef = useRef<Map<string, {
    startX: number;
    startY: number;
    targetX: number;
    targetY: number;
    startTs: number;
    delay: number;
    duration: number;
    finished: boolean;
  }>>(new Map());
  // View transform: zoom and center in reference coords
  const viewScaleRef = useRef<number>(1);
  const viewCenterRef = useRef<{ x: number; y: number }>({ x: REF_W / 2, y: REF_H / 2 });
  const userIdRef = useRef<string | null>(null);
  const highlightedRef = useRef<string | null>(null);
  /** id → timestamp when resonance glow started (scales + pulses) */
  const glowMapRef = useRef<Map<string, number>>(new Map());
  /** id → { ts, similarity } when similarity glow started (just glow, no scaling) */
  const similarityGlowMapRef = useRef<Map<string, { ts: number; similarity: number }>>(new Map());
  const lastTapRef = useRef<{ id: string; time: number } | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [similarPanel, setSimilarPanel] = useState<SimilarPanel | null>(null);
  const [panelVisible, setPanelVisible] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Entry | null>(null);
  const [releaseMsgMounted, setReleaseMsgMounted] = useState(false);
  const [releaseMsgVisible, setReleaseMsgVisible] = useState(false);

  // Deletion animation state (canvas-driven, lives in refs)
  const deletingBlobsRef = useRef<Map<string, {
    startTs: number; x: number; y: number;
    color: string; shape: Entry['shape']; id: string;
  }>>(new Map());
  const particlesRef = useRef<Array<{
    x: number; y: number; vx: number; vy: number;
    alpha: number; size: number; color: string;
  }>>([]);

  // Long-press detection refs
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressConsumedRef = useRef(false);
  const longPressStartCssRef = useRef<{ x: number; y: number } | null>(null);

  // Drag panning state
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{ cssX: number; cssY: number; centerX: number; centerY: number } | null>(null);
  const lastTouchDistanceRef = useRef<number | null>(null);

  // Exposed controls (JSX handlers) to zoom programmatically
  const zoomAround = (factor: number, cssX?: number, cssY?: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cssW = canvas.offsetWidth;
    const cssH = canvas.offsetHeight;
    const base = Math.min(cssW / REF_W, cssH / REF_H);
    const oldScale = viewScaleRef.current;
    const newScale = Math.max(0.25, Math.min(6, oldScale * factor));
    const focusX = cssX === undefined ? cssW / 2 : cssX;
    const focusY = cssY === undefined ? cssH / 2 : cssY;
    const effectiveOld = base * oldScale;
    const rx = (focusX - cssW / 2) / effectiveOld + viewCenterRef.current.x;
    const ry = (focusY - cssH / 2) / effectiveOld + viewCenterRef.current.y;
    const effectiveNew = base * newScale;
    viewCenterRef.current.x = rx - (focusX - cssW / 2) / effectiveNew;
    viewCenterRef.current.y = ry - (focusY - cssH / 2) / effectiveNew;
    viewScaleRef.current = newScale;
  };

  const resetView = () => {
    viewScaleRef.current = 1;
    viewCenterRef.current = { x: REF_W / 2, y: REF_H / 2 };
  };

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
        const knownIds = new Set(entriesRef.current.map((e) => e.id));
        const targets = Array.from(displayPosRef.current.values()).map((m) => ({ x: m.targetX, y: m.targetY }));
        for (const s of similar) {
          if (s.id === blob.id) continue;
          // If the similar entry is not present locally, insert it at the spiral tail
          if (!knownIds.has(s.id)) {
            const centerX = REF_W / 2;
            const centerY = REF_H / 2;
            const angleStep = 0.45;
            const spiralSeparation = Math.max(22, BLOB_RADIUS + 6);
            const minDist = Math.max(Math.ceil(BLOB_RADIUS * 4.2), BLOB_RADIUS * 2 + 24);
            const idx = entriesRef.current.length;
            let angle = idx * angleStep;
            let radius = spiralSeparation * angle + 16;
            let tx = Math.round(centerX + Math.cos(angle) * radius);
            let ty = Math.round(centerY + Math.sin(angle) * radius);
            const deltaAngle = 0.25;
            for (let pass = 0; pass < 24; pass++) {
              const clash = targets.find((t) => Math.hypot(t.x - tx, t.y - ty) < minDist);
              if (!clash) break;
              angle += deltaAngle;
              radius = spiralSeparation * angle + 16;
              tx = Math.round(centerX + Math.cos(angle) * radius);
              ty = Math.round(centerY + Math.sin(angle) * radius);
            }
            entriesRef.current.push(s);
            const now2 = Date.now();
            displayPosRef.current.set(s.id, {
              startX: tx,
              startY: ty,
              targetX: tx,
              targetY: ty,
              startTs: now2,
              delay: 0,
              duration: 200,
              finished: true,
            });
            knownIds.add(s.id);
            targets.push({ x: tx, y: ty });
          }
          console.log('[handleSelect] Setting similarity glow for:', s.id, 'similarity=', s.similarity);
          similarityGlowMapRef.current.set(s.id, { ts, similarity: (s as any).similarity ?? 0.6 });
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
        const knownIds = new Set(entriesRef.current.map((e) => e.id));
        const targets = Array.from(displayPosRef.current.values()).map((m) => ({ x: m.targetX, y: m.targetY }));
        for (const s of similar) {
          if (s.id === blob.id) continue;
          if (!knownIds.has(s.id)) {
            const centerX = REF_W / 2;
            const centerY = REF_H / 2;
            const angleStep = 0.45;
            const spiralSeparation = Math.max(14, BLOB_RADIUS + 4);
            const minDist = Math.max(Math.ceil(BLOB_RADIUS * 3.2), BLOB_RADIUS * 2 + 12);
            const idx = entriesRef.current.length;
            let angle = idx * angleStep;
            let radius = spiralSeparation * angle + 12;
            let tx = Math.round(centerX + Math.cos(angle) * radius);
            let ty = Math.round(centerY + Math.sin(angle) * radius);
            const deltaAngle = 0.25;
            for (let pass = 0; pass < 24; pass++) {
              const clash = targets.find((t) => Math.hypot(t.x - tx, t.y - ty) < minDist);
              if (!clash) break;
              angle += deltaAngle;
              radius = spiralSeparation * angle + 12;
              tx = Math.round(centerX + Math.cos(angle) * radius);
              ty = Math.round(centerY + Math.sin(angle) * radius);
            }
            entriesRef.current.push(s);
            const now2 = Date.now();
            displayPosRef.current.set(s.id, {
              startX: tx,
              startY: ty,
              targetX: tx,
              targetY: ty,
              startTs: now2,
              delay: 0,
              duration: 200,
              finished: true,
            });
            knownIds.add(s.id);
            targets.push({ x: tx, y: ty });
          }
          console.log('[handleSelect] Setting similarity glow for:', s.id, 'similarity=', s.similarity);
          similarityGlowMapRef.current.set(s.id, { ts, similarity: (s as any).similarity ?? 0.6 });
        }
      } catch (err) {
        console.error('[handleSelect] Fetch error:', err);
      }
    }
  }, []);

  // Optimistically remove blob, start canvas animations, call DELETE API
  const handleDelete = useCallback(async (entry: Entry) => {
    const userId = getUserId();
    if (!userId || entry.user_id !== userId) return;

    const meta = displayPosRef.current.get(entry.id);
    const x = meta ? meta.targetX : entry.x;
    const y = meta ? meta.targetY : entry.y;

    // Register blob for the float-upward fade animation
    deletingBlobsRef.current.set(entry.id, {
      startTs: Date.now(), x, y,
      color: entry.color, shape: entry.shape, id: entry.id,
    });

    // Spawn 26 dandelion-seed particles
    for (let i = 0; i < 26; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.2 + Math.random() * 0.4;
      particlesRef.current.push({
        x: x + (Math.random() - 0.5) * 8,
        y: y + (Math.random() - 0.5) * 8,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed * 0.6 - 0.3, // upward bias
        alpha: 0.7 + Math.random() * 0.3,
        size: 1.0 + Math.random() * 1.5,
        color: entry.color,
      });
    }

    // Optimistically remove from canvas state
    entriesRef.current = entriesRef.current.filter((e) => e.id !== entry.id);
    displayPosRef.current.delete(entry.id);
    glowMapRef.current.delete(entry.id);
    similarityGlowMapRef.current.delete(entry.id);
    if (highlightedRef.current === entry.id) highlightedRef.current = null;
    setSimilarPanel(null);

    // Fire-and-forget API call
    fetch('/api/entry', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: entry.id, user_id: userId }),
    }).catch(() => {});

    // Show the release message after the blob starts floating
    setTimeout(() => {
      setReleaseMsgMounted(true);
      requestAnimationFrame(() => requestAnimationFrame(() => setReleaseMsgVisible(true)));
      setTimeout(() => {
        setReleaseMsgVisible(false);
        setTimeout(() => setReleaseMsgMounted(false), 700);
      }, 2500);
    }, 400);
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
        // Arrange entries into a spiral and reset their visible positions so
        // they animate in from the center start point.
        scheduleSpiralPositions(data);
        setLoading(false);
      })
      .catch(() => {
        setError('Could not load the mural.');
        setLoading(false);
      });
  }, []);

  // Compute spiral targets for a list of entries and populate displayPosRef
  function scheduleSpiralPositions(entries: Entry[]) {
    const now = Date.now();
    const centerX = REF_W / 2;
    const centerY = REF_H / 2;

      // Use an Archimedean spiral (r = k * theta) so the circular spiral is obvious
      const angleStep = 0.45; // radians between points (~26deg) — tighter spiral
      // Increase separation to account for visual blob size at the center
      const spiralSeparation = Math.max(22, BLOB_RADIUS + 6); // radial spacing per radian (further increased)
      // Require a significantly larger minimum pixel gap to avoid early-center congestion
      const minDist = Math.max(Math.ceil(BLOB_RADIUS * 4.2), BLOB_RADIUS * 2 + 24);

      displayPosRef.current.clear();
      const targets: { x: number; y: number }[] = [];

      const computeTargetForIndex = (index: number) => {
        // Keep points on an Archimedean spiral: r = k * theta
        // If there's a collision, advance the angle slightly so the point moves along
        // the spiral rather than jumping radially — preserves a smooth spiral layout.
        let angle = index * angleStep;
        const baseOffset = 16;
        let radius = spiralSeparation * angle + baseOffset;
        let tx = Math.round(centerX + Math.cos(angle) * radius);
        let ty = Math.round(centerY + Math.sin(angle) * radius);
        // Advance along the spiral on collision
        const deltaAngle = 0.25; // radians to advance per nudge
        for (let pass = 0; pass < 24; pass++) {
          const clash = targets.find((t) => Math.hypot(t.x - tx, t.y - ty) < minDist);
          if (!clash) break;
          angle += deltaAngle;
          radius = spiralSeparation * angle + baseOffset;
          tx = Math.round(centerX + Math.cos(angle) * radius);
          ty = Math.round(centerY + Math.sin(angle) * radius);
        }
        return { tx, ty };
      };

      // If any entries are very recent (just created), place them at the tail
      // so returning from submit doesn't animate the new blob from the center.
      const RECENT_MS = 5000;
      let tailIndex = entries.length;
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        const createdAt = e.created_at ? new Date(e.created_at).getTime() : 0;
        const isRecent = Date.now() - createdAt < RECENT_MS;

        // Choose index: recent items go to the tail, others use their ordinal
        const useIndex = isRecent ? tailIndex++ : i;
        const { tx, ty } = computeTargetForIndex(useIndex);
        targets.push({ x: tx, y: ty });

        // Animate from the center for older items; for recent items show immediately
        const delay = (isRecent ? 0 : i * 70);
        const duration = isRecent ? 200 : 600 + Math.min(500, i * 8);

        displayPosRef.current.set(e.id, {
          startX: isRecent ? tx : centerX,
          startY: isRecent ? ty : centerY,
          targetX: tx,
          targetY: ty,
          startTs: now,
          delay,
          duration,
          finished: isRecent,
        });
      }
  }

  // Insert a single new entry and place it at the spiral tail
  function insertEntryAtTail(entry: Entry) {
    const targets = Array.from(displayPosRef.current.values()).map((m) => ({
      x: m.targetX,
      y: m.targetY,
    }));

    const centerX = REF_W / 2;
    const centerY = REF_H / 2;
    const angleStep = 0.45;
    const spiralSeparation = Math.max(14, BLOB_RADIUS + 4);
    const minDist = Math.max(Math.ceil(BLOB_RADIUS * 3.2), BLOB_RADIUS * 2 + 12);

    const idx = entriesRef.current.length;
    let angle = idx * angleStep;
    const baseOffset = 16;
    let radius = spiralSeparation * angle + baseOffset;

    let tx = Math.round(centerX + Math.cos(angle) * radius);
    let ty = Math.round(centerY + Math.sin(angle) * radius);

    const deltaAngle = 0.25;
    for (let pass = 0; pass < 24; pass++) {
      const clash = targets.find((t) => Math.hypot(t.x - tx, t.y - ty) < minDist);
      if (!clash) break;
      angle += deltaAngle;
      radius = spiralSeparation * angle + baseOffset;
      tx = Math.round(centerX + Math.cos(angle) * radius);
      ty = Math.round(centerY + Math.sin(angle) * radius);
    }

    entriesRef.current.push(entry);

    const now = Date.now();
    displayPosRef.current.set(entry.id, {
      startX: tx,
      startY: ty,
      targetX: tx,
      targetY: ty,
      startTs: now,
      delay: 0,
      duration: 200,
      finished: true,
    });
  }



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

  // Poll for new entries and insert them at the spiral tail so newer blobs
  // appear around the outer spiral instead of crowding the center.
  useEffect(() => {
    let running = true;

    const pollNew = async () => {
      try {
        const res = await fetch('/api/stream');
        if (!res.ok) return;
        const data: Entry[] = await res.json();
        if (!running) return;
        const known = new Set(entriesRef.current.map((e) => e.id));
        // stream returns newest first; we want to insert oldest->newest so reverse
        const newItems = data.filter((d) => !known.has(d.id)).reverse();
        for (const item of newItems) {
          insertEntryAtTail(item);
        }
      } catch {
        // fail silently
      }
    };

    // initial poll shortly after mount to pick up entries created while user navigated
    const id = setInterval(pollNew, 2500);
    // also run once immediately
    pollNew();
    return () => {
      running = false;
      clearInterval(id);
    };
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

      const baseScaleX = cssW / REF_W;
      const baseScaleY = cssH / REF_H;
      // Use uniform base scale (preserve aspect), then apply view scale
      const baseScale = Math.min(baseScaleX, baseScaleY);
      const viewScale = viewScaleRef.current;
      const effectiveScale = baseScale * viewScale;
      const blobR = BLOB_RADIUS * effectiveScale;
      const now = Date.now();

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.scale(dpr, dpr); // draw in CSS-pixel space from here on

      // Background
      ctx.fillStyle = '#0a0a0f';
      ctx.fillRect(0, 0, cssW, cssH);

      for (const entry of entriesRef.current) {
        // Compute displayed reference-space position (animated from spawn)
        const disp = (() => {
          const meta = displayPosRef.current.get(entry.id);
          if (!meta) return { rx: entry.x, ry: entry.y };
          const elapsed = now - meta.startTs;
          const tRaw = (elapsed - meta.delay) / meta.duration;
          const t = Math.max(0, Math.min(1, tRaw));
          // smooth easing
          const ease = 0.5 - 0.5 * Math.cos(Math.PI * t);
          const rx = meta.startX + (meta.targetX - meta.startX) * ease;
          const ry = meta.startY + (meta.targetY - meta.startY) * ease;
          if (t >= 1 && !meta.finished) {
            meta.finished = true;
            // commit final ref coords back to the entry for persistence
            entry.x = meta.targetX;
            entry.y = meta.targetY;
            displayPosRef.current.set(entry.id, meta);
          }
          return { rx, ry };
        })();

        // Map reference coords to CSS pixel space with view transform
        const vc = viewCenterRef.current;
        const x = (disp.rx - vc.x) * effectiveScale + cssW / 2;
        const y = (disp.ry - vc.y) * effectiveScale + cssH / 2;
        const isHighlighted = highlightedRef.current === entry.id;
        const isOwnBlob =
          !!entry.user_id && entry.user_id === userIdRef.current;
        const glowStart = glowMapRef.current.get(entry.id);
        const glowAge = glowStart !== undefined ? now - glowStart : -1;
        const isGlowing = glowAge >= 0 && glowAge < GLOW_DURATION;

        const similarityGlowObj = similarityGlowMapRef.current.get(entry.id);
        const similarityGlowAge = similarityGlowObj !== undefined ? now - similarityGlowObj.ts : -1;
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
          // Similarity glow: intensity depends on similarity magnitude and fades out
          const fade = 1 - t;
          const sim = similarityGlowObj?.similarity ?? 0.6;
          // Map similarity to three tiers: very similar (>0.85), pretty (>0.7), slight (>0.5)
          let blur = 14 * fade;
          let alphaSuffix = 'aa';
          if (sim > 0.85) {
            blur = 84 * fade; // very bright (doubled)
            alphaSuffix = 'ff';
          } else if (sim > 0.7) {
            blur = 56 * fade; // bright (doubled)
            alphaSuffix = 'ff';
          } else if (sim > 0.5) {
            blur = 32 * fade; // slightly bright (doubled)
            alphaSuffix = 'dd';
          }
          ctx.shadowColor = entry.color;
          ctx.shadowBlur = blur;
          ctx.fillStyle = entry.color + alphaSuffix;
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

      // ── Deletion: blob floats upward and fades ──────────────────────────
      for (const [delId, info] of deletingBlobsRef.current.entries()) {
        const elapsed = now - info.startTs;
        const FLOAT_DUR = 1800;
        if (elapsed > FLOAT_DUR) { deletingBlobsRef.current.delete(delId); continue; }
        const t = elapsed / FLOAT_DUR;
        const alpha = Math.max(0, 1 - t * 1.05);
        const fy = info.y - elapsed * 0.04; // float upward in ref coords
        const vc = viewCenterRef.current;
        const dcx = (info.x - vc.x) * effectiveScale + cssW / 2;
        const dcy = (fy - vc.y) * effectiveScale + cssH / 2;
        const dseed = seedFromId(info.id);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = info.color;
        ctx.shadowColor = info.color;
        ctx.shadowBlur = 12 * alpha;
        switch (info.shape) {
          case 'smooth': drawSmooth(ctx, dcx, dcy, blobR); break;
          case 'spiky':  drawSpiky(ctx, dcx, dcy, blobR); break;
          case 'jagged': drawJagged(ctx, dcx, dcy, blobR, dseed); break;
          default:       drawSmooth(ctx, dcx, dcy, blobR);
        }
        ctx.restore();
      }

      // ── Dandelion seed particles ────────────────────────────────────────
      const nextParticles: typeof particlesRef.current = [];
      for (const p of particlesRef.current) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy -= 0.007; // upward buoyancy
        p.alpha -= 0.011;
        if (p.alpha > 0) {
          const vc = viewCenterRef.current;
          const pcx = (p.x - vc.x) * effectiveScale + cssW / 2;
          const pcy = (p.y - vc.y) * effectiveScale + cssH / 2;
          ctx.save();
          ctx.globalAlpha = Math.max(0, p.alpha);
          ctx.fillStyle = p.color;
          ctx.shadowColor = p.color;
          ctx.shadowBlur = 4;
          ctx.beginPath();
          ctx.arc(pcx, pcy, p.size * effectiveScale, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          nextParticles.push(p);
        }
      }
      particlesRef.current = nextParticles;

      ctx.restore();
      animId = requestAnimationFrame(draw);
    };

    animId = requestAnimationFrame(draw);

    // ── Shared helpers ──────────────────────────────────────────────────────

    /** Convert a CSS-pixel canvas position to reference coords */
    const toRef = (cssX: number, cssY: number) => {
      const cssW = canvas.offsetWidth;
      const cssH = canvas.offsetHeight;
      const base = Math.min(cssW / REF_W, cssH / REF_H);
      const effective = base * viewScaleRef.current;
      const vc = viewCenterRef.current;
      const rx = (cssX - cssW / 2) / effective + vc.x;
      const ry = (cssY - cssH / 2) / effective + vc.y;
      return { rx, ry };
    };

    /** Find the topmost blob within HIT_RADIUS of (rx, ry) in ref space */
    const findBlob = (rx: number, ry: number): Entry | null => {
      const nowTs = Date.now();
      for (let i = entriesRef.current.length - 1; i >= 0; i--) {
        const e = entriesRef.current[i];
        const meta = displayPosRef.current.get(e.id);
        let ex = e.x;
        let ey = e.y;
        if (meta) {
          const elapsed = nowTs - meta.startTs;

    // Insert a single new entry and place it at the spiral tail (so newer blobs appear at the outer spiral)
    const insertEntryAtTail = (entry: Entry) => {
      // Build a local targets array from current displayPos
      const targets = Array.from(displayPosRef.current.values()).map((m) => ({ x: m.targetX, y: m.targetY }));
      const centerX = REF_W / 2;
      const centerY = REF_H / 2;
      const angleStep = 0.45;
      const spiralSeparation = Math.max(14, BLOB_RADIUS + 4);
      const minDist = Math.max(Math.ceil(BLOB_RADIUS * 3.2), BLOB_RADIUS * 2 + 12);

      const idx = entriesRef.current.length; // next index at tail
      let angle = idx * angleStep;
      const baseOffset = 16;
      let radius = spiralSeparation * angle + baseOffset;
      let tx = Math.round(centerX + Math.cos(angle) * radius);
      let ty = Math.round(centerY + Math.sin(angle) * radius);
      const deltaAngle = 0.25;
      for (let pass = 0; pass < 24; pass++) {
        const clash = targets.find((t) => Math.hypot(t.x - tx, t.y - ty) < minDist);
        if (!clash) break;
        angle += deltaAngle;
        radius = spiralSeparation * angle + baseOffset;
        tx = Math.round(centerX + Math.cos(angle) * radius);
        ty = Math.round(centerY + Math.sin(angle) * radius);
      }

      // Add into entries and display map. Place start at the target so center isn't cluttered.
      entriesRef.current.push(entry);
      const now = Date.now();
      displayPosRef.current.set(entry.id, {
        startX: tx,
        startY: ty,
        targetX: tx,
        targetY: ty,
        startTs: now,
        delay: 0,
        duration: 200,
        finished: true,
      });
    };
          const tRaw = (elapsed - meta.delay) / meta.duration;
          const t = Math.max(0, Math.min(1, tRaw));
          const ease = 0.5 - 0.5 * Math.cos(Math.PI * t);
          ex = meta.startX + (meta.targetX - meta.startX) * ease;
          ey = meta.startY + (meta.targetY - meta.startY) * ease;
        }
        if (Math.hypot(ex - rx, ey - ry) <= HIT_RADIUS) return e;
      }
      return null;
    };

    const handleDblClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const { rx, ry } = toRef(e.clientX - rect.left, e.clientY - rect.top);
      const blob = findBlob(rx, ry);
      if (blob) handleResonate(blob.id);
    };

    const handleMouseDown = (e: MouseEvent) => {
      // Don't interfere with other mouse buttons or modifier keys
      if (e.button !== 0) return; // left button only

      isDraggingRef.current = true;
      dragStartRef.current = {
        cssX: e.clientX,
        cssY: e.clientY,
        centerX: viewCenterRef.current.x,
        centerY: viewCenterRef.current.y,
      };

      // Long-press detection — only on own blobs
      const rect = canvas.getBoundingClientRect();
      const { rx, ry } = toRef(e.clientX - rect.left, e.clientY - rect.top);
      const blob = findBlob(rx, ry);
      if (blob && blob.user_id && blob.user_id === userIdRef.current) {
        longPressStartCssRef.current = { x: e.clientX, y: e.clientY };
        longPressTimerRef.current = setTimeout(() => {
          longPressTimerRef.current = null;
          longPressStartCssRef.current = null;
          longPressConsumedRef.current = true;
          isDraggingRef.current = false;
          dragStartRef.current = null;
          setDeleteTarget(blob);
        }, 500);
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (longPressTimerRef.current && longPressStartCssRef.current) {
        const d = Math.hypot(e.clientX - longPressStartCssRef.current.x, e.clientY - longPressStartCssRef.current.y);
        if (d > 8) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
          longPressStartCssRef.current = null;
        }
      }
      if (!isDraggingRef.current || !dragStartRef.current) return;
      
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const cssW = canvas.offsetWidth;
      const cssH = canvas.offsetHeight;
      const base = Math.min(cssW / REF_W, cssH / REF_H);
      const effective = base * viewScaleRef.current;

      // Calculate drag delta in CSS pixels
      const deltaCssX = e.clientX - dragStartRef.current.cssX;
      const deltaCssY = e.clientY - dragStartRef.current.cssY;

      // Convert CSS delta to reference coords (opposite direction)
      const deltaRefX = (-deltaCssX) / effective;
      const deltaRefY = (-deltaCssY) / effective;

      // Update view center
      viewCenterRef.current.x = dragStartRef.current.centerX + deltaRefX;
      viewCenterRef.current.y = dragStartRef.current.centerY + deltaRefY;
    };

    const handleMouseUp = () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
        longPressStartCssRef.current = null;
      }
      isDraggingRef.current = false;
      dragStartRef.current = null;
    };

    const handleMouseLeave = () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
        longPressStartCssRef.current = null;
      }
      isDraggingRef.current = false;
      dragStartRef.current = null;
    };

    const handleTouchStart = (e: TouchEvent) => {
      lastTouchDistanceRef.current = null;

      if (e.touches.length === 1) {
        // Single finger: start drag panning
        e.preventDefault();
        const touch = e.touches[0];
        isDraggingRef.current = true;
        dragStartRef.current = {
          cssX: touch.clientX,
          cssY: touch.clientY,
          centerX: viewCenterRef.current.x,
          centerY: viewCenterRef.current.y,
        };

        // Long-press detection — only on own blobs
        const rect = canvas.getBoundingClientRect();
        const { rx, ry } = toRef(touch.clientX - rect.left, touch.clientY - rect.top);
        const blob = findBlob(rx, ry);
        if (blob && blob.user_id && blob.user_id === userIdRef.current) {
          longPressStartCssRef.current = { x: touch.clientX, y: touch.clientY };
          longPressTimerRef.current = setTimeout(() => {
            longPressTimerRef.current = null;
            longPressStartCssRef.current = null;
            longPressConsumedRef.current = true;
            isDraggingRef.current = false;
            dragStartRef.current = null;
            setDeleteTarget(blob);
          }, 500);
        }
      } else if (e.touches.length === 2) {
        // Two fingers: cancel long-press and prepare for pinch zoom
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
          longPressStartCssRef.current = null;
        }
        isDraggingRef.current = false;
        dragStartRef.current = null;
        const touch1 = e.touches[0];
        const touch2 = e.touches[1];
        const distance = Math.hypot(
          touch2.clientX - touch1.clientX,
          touch2.clientY - touch1.clientY
        );
        lastTouchDistanceRef.current = distance;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      // Cancel long-press if finger moved too far
      if (longPressTimerRef.current && longPressStartCssRef.current && e.touches.length === 1) {
        const t = e.touches[0];
        const d = Math.hypot(t.clientX - longPressStartCssRef.current.x, t.clientY - longPressStartCssRef.current.y);
        if (d > 8) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
          longPressStartCssRef.current = null;
        }
      }
      if (e.touches.length === 1 && isDraggingRef.current && dragStartRef.current) {
        // Single finger drag: pan
        e.preventDefault();
        const touch = e.touches[0];
        const canvas = canvasRef.current;
        if (!canvas) return;

        const cssW = canvas.offsetWidth;
        const cssH = canvas.offsetHeight;
        const base = Math.min(cssW / REF_W, cssH / REF_H);
        const effective = base * viewScaleRef.current;

        const deltaCssX = touch.clientX - dragStartRef.current.cssX;
        const deltaCssY = touch.clientY - dragStartRef.current.cssY;

        const deltaRefX = (-deltaCssX) / effective;
        const deltaRefY = (-deltaCssY) / effective;

        viewCenterRef.current.x = dragStartRef.current.centerX + deltaRefX;
        viewCenterRef.current.y = dragStartRef.current.centerY + deltaRefY;
      } else if (e.touches.length === 2) {
        // Two finger pinch: zoom
        e.preventDefault();
        const touch1 = e.touches[0];
        const touch2 = e.touches[1];
        const distance = Math.hypot(
          touch2.clientX - touch1.clientX,
          touch2.clientY - touch1.clientY
        );

        if (lastTouchDistanceRef.current !== null) {
          const ratio = distance / lastTouchDistanceRef.current;
          const factor = Math.max(0.8, Math.min(1.2, ratio)); // Limit scale per frame
          const midCssX = (touch1.clientX + touch2.clientX) / 2;
          const midCssY = (touch1.clientY + touch2.clientY) / 2;
          const rect = canvasRef.current?.getBoundingClientRect();
          if (rect) {
            setViewScale(viewScaleRef.current * factor, midCssX - rect.left, midCssY - rect.top);
          }
        }
        lastTouchDistanceRef.current = distance;
      }
    };

    const handleTouchCancel = () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
        longPressStartCssRef.current = null;
      }
      isDraggingRef.current = false;
      dragStartRef.current = null;
      lastTouchDistanceRef.current = null;
    };


    const handleClick = (e: MouseEvent) => {
      if (longPressConsumedRef.current) {
        longPressConsumedRef.current = false;
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const { rx, ry } = toRef(e.clientX - rect.left, e.clientY - rect.top);
      const blob = findBlob(rx, ry);
      if (blob) handleSelect(blob);
    };

    const handleTouchEnd = (e: TouchEvent) => {
      // Cancel any pending long-press timer
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
        longPressStartCssRef.current = null;
      }

      lastTouchDistanceRef.current = null;

      // Long-press was consumed — skip tap handling
      if (longPressConsumedRef.current) {
        longPressConsumedRef.current = false;
        isDraggingRef.current = false;
        dragStartRef.current = null;
        return;
      }

      // If we were dragging (single finger), don't process as a tap
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        dragStartRef.current = null;
        return;
      }

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
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseleave', handleMouseLeave);
    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('touchcancel', handleTouchCancel);
    // Wheel to zoom (keep focused point stable)
    const setViewScale = (newScale: number, focusCssX?: number, focusCssY?: number) => {
      const cssW = canvas.offsetWidth;
      const cssH = canvas.offsetHeight;
      const base = Math.min(cssW / REF_W, cssH / REF_H);
      const oldScale = viewScaleRef.current;
      newScale = Math.max(0.25, Math.min(6, newScale));
      if (focusCssX !== undefined && focusCssY !== undefined) {
        const effectiveOld = base * oldScale;
        const rx = (focusCssX - cssW / 2) / effectiveOld + viewCenterRef.current.x;
        const ry = (focusCssY - cssH / 2) / effectiveOld + viewCenterRef.current.y;
        const effectiveNew = base * newScale;
        viewCenterRef.current.x = rx - (focusCssX - cssW / 2) / effectiveNew;
        viewCenterRef.current.y = ry - (focusCssY - cssH / 2) / effectiveNew;
      }
      viewScaleRef.current = newScale;
    };

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const cssX = e.clientX - rect.left;
      const cssY = e.clientY - rect.top;
      const delta = -e.deltaY; // wheel up => zoom in
      const factor = Math.exp(delta * 0.0014);
      setViewScale(viewScaleRef.current * factor, cssX, cssY);
    };
    canvas.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('click', handleClick);
      canvas.removeEventListener('dblclick', handleDblClick);
      canvas.removeEventListener('touchend', handleTouchEnd);
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
      canvas.removeEventListener('touchstart', handleTouchStart);
      canvas.removeEventListener('touchmove', handleTouchMove);
      canvas.removeEventListener('touchcancel', handleTouchCancel);
      canvas.removeEventListener('wheel', handleWheel as any);
    };
  }, []); // runs once — all mutable state is in refs

  return (
    <div className="relative w-full h-screen bg-[#0a0a0f] overflow-hidden">
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        style={{ touchAction: 'none' }}
      />

      {/* Zoom controls */}
      <div className="absolute top-20 right-4 z-30 flex flex-col gap-2">
        <button
          onClick={() => zoomAround(1.25)}
          className="w-9 h-9 bg-white/8 hover:bg-white/16 text-white rounded-md flex items-center justify-center"
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          onClick={() => zoomAround(1 / 1.25)}
          className="w-9 h-9 bg-white/8 hover:bg-white/16 text-white rounded-md flex items-center justify-center"
          aria-label="Zoom out"
        >
          −
        </button>
        <button
          onClick={() => resetView()}
          className="w-9 h-9 bg-white/6 hover:bg-white/16 text-white rounded-md flex items-center justify-center text-xs"
          aria-label="Reset view"
        >
          reset
        </button>
      </div>

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

      {/* ── Cathartic Deletion Ritual ─────────────────────────────────────── */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setDeleteTarget(null)}
        >
          <div
            className="w-full max-w-sm bg-[#0e0e1a] border border-white/10 rounded-2xl p-6 flex flex-col gap-5"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-white/75 text-sm tracking-wide">let this go?</p>
            <p className="text-white/35 text-xs leading-relaxed italic line-clamp-3">
              &ldquo;{deleteTarget.message}&rdquo;
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="flex-1 py-3 rounded-xl border border-white/10 text-white/30 text-xs tracking-widest uppercase hover:text-white/50 hover:border-white/20 transition-all"
              >
                keep it
              </button>
              <button
                onClick={() => {
                  const entry = deleteTarget;
                  setDeleteTarget(null);
                  handleDelete(entry);
                }}
                className="flex-1 py-3 rounded-xl bg-white/[0.04] border border-white/15 text-white/65 text-xs tracking-widest uppercase hover:bg-white/[0.08] hover:text-white/85 transition-all"
              >
                let it go
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Release message ──────────────────────────────────────────────── */}
      {releaseMsgMounted && (
        <div
          className={`fixed inset-0 z-40 flex items-center justify-center pointer-events-none transition-opacity duration-700 ${releaseMsgVisible ? 'opacity-100' : 'opacity-0'}`}
        >
          <div className="text-center px-8">
            <p className="text-white/45 text-sm tracking-wide leading-relaxed">
              you held this.
            </p>
            <p className="text-white/25 text-xs tracking-widest mt-2">
              now it can float away.
            </p>
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
