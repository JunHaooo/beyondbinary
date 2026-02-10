'use client';

import { useRef, useEffect } from 'react';
import { drawSmooth, drawSpiky, drawJagged, seedFromId } from '@/lib/shapes';

interface Props {
  id: string;
  color: string;
  shape: 'spiky' | 'smooth' | 'jagged';
  size?: number;
}

const BASE_SIZE = 160;
const BASE_RADIUS = 52;

export default function BlobPreview({ id, color, shape, size = BASE_SIZE }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;

    const seed = seedFromId(id);
    const scale = size / BASE_SIZE;
    const startTime = Date.now();
    let animId: number;

    const draw = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const elapsed = (Date.now() - startTime) / 1000;
      const breathe = 1 + 0.08 * Math.sin(elapsed * 1.6);

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.scale(dpr, dpr);

      const cx = size / 2;
      const cy = size / 2;
      const r = BASE_RADIUS * scale * breathe;

      ctx.shadowColor = color;
      ctx.shadowBlur = scale * (18 + 10 * Math.sin(elapsed * 1.6));
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
  }, [id, color, shape, size]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size }}
    />
  );
}
