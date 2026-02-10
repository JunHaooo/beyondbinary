/** Deterministic float 0–1 derived from a UUID string */
export function seedFromId(id: string): number {
  return parseInt(id.replace(/-/g, '').slice(0, 8), 16) / 0xffffffff;
}

export function drawSmooth(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

export function drawSpiky(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
) {
  const spikes = 8;
  const inner = r * 0.42;
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const angle = (i * Math.PI) / spikes - Math.PI / 2;
    const len = i % 2 === 0 ? r : inner;
    const px = x + Math.cos(angle) * len;
    const py = y + Math.sin(angle) * len;
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

export function drawJagged(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  seed: number,
) {
  const pts = 7;
  ctx.beginPath();
  for (let i = 0; i < pts; i++) {
    const angle = (i * 2 * Math.PI) / pts - Math.PI / 2;
    const jitter = 0.45 + 0.9 * ((Math.sin(seed * 100 + i * 2.4) + 1) / 2);
    const px = x + Math.cos(angle) * r * jitter;
    const py = y + Math.sin(angle) * r * jitter;
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}
