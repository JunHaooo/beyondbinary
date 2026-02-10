'use client';

import { useRef, useEffect } from 'react';
import { drawSmooth, drawSpiky, drawJagged, seedFromId } from '@/lib/shapes';

interface Props {
  id: string;
  color: string;
  shape: 'spiky' | 'smooth' | 'jagged';
}

const SIZE = 160; // CSS pixels

export default function BlobPreview({ id, color, shape }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;

    const seed = seedFromId(id);
    const startTime = Date.now();
    let animId: number;

    const draw = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const elapsed = (Date.now() - startTime) / 1000;
      // Gentle breathing: ±8% size oscillation
      const breathe = 1 + 0.08 * Math.sin(elapsed * 1.6);

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.scale(dpr, dpr);

      const cx = SIZE / 2;
      const cy = SIZE / 2;
      const r = 52 * breathe;

      ctx.shadowColor = color;
      ctx.shadowBlur = 18 + 10 * Math.sin(elapsed * 1.6);
      ctx.fillStyle = color;

      switch (shape) {
        case 'smooth': drawSmooth(ctx, cx, cy, r); break;
        case 'spiky':  drawSpiky(ctx, cx, cy, r);  break;
        case 'jagged': drawJagged(ctx, cx, cy, r, seed); break;
      }

      ctx.restore();
      animId = requestAnimationFrame(draw);
    };

    animId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animId);
  }, [id, color, shape]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: SIZE, height: SIZE }}
    />
  );
}
