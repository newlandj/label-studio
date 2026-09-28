/**
 * Hit testing and painting for PDF marks ("atoms").
 *
 * Ported from spatial-ml tools/object_labeler/frontend/src/view.ts so picks
 * rank the same way they did in the object labeler PoC.
 */

export type Atom = {
  atom_id: string;
  kind: string;
  points: number[][];
  color?: string | null;
  lineweight?: number | null;
};

export type Camera = { x: number; y: number; z: number };

const CELL = 24;

const boxes = new WeakMap<Atom, number[]>();

export function bboxOf(atom: Atom): number[] {
  const cached = boxes.get(atom);
  if (cached) return cached;
  const pts = atom.points;
  if (!pts.length) return [0, 0, 0, 0];
  let x0 = pts[0][0];
  let y0 = pts[0][1];
  let x1 = x0;
  let y1 = y0;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  const box = [x0, y0, x1, y1];
  boxes.set(atom, box);
  return box;
}

export function extentOf(atoms: Atom[]): number[] {
  if (!atoms.length) return [0, 0, 1, 1];
  const out = [...bboxOf(atoms[0])];
  for (const atom of atoms) {
    const b = bboxOf(atom);
    out[0] = Math.min(out[0], b[0]);
    out[1] = Math.min(out[1], b[1]);
    out[2] = Math.max(out[2], b[2]);
    out[3] = Math.max(out[3], b[3]);
  }
  return out;
}

export function unionBox(atoms: Atom[]): number[] | null {
  return atoms.length ? extentOf(atoms) : null;
}

export function insideCrop(x: number, y: number, cropW: number, cropH: number): boolean {
  return x >= 0 && y >= 0 && x <= cropW && y <= cropH;
}

export function localize(atoms: Atom[], originX: number, originY: number): Atom[] {
  return atoms.map((atom) => ({
    ...atom,
    points: atom.points.map(([x, y]) => [x - originX, y - originY]),
  }));
}

export class GridIndex {
  private cells = new Map<string, number[]>();

  constructor(readonly atoms: Atom[]) {
    atoms.forEach((atom, index) => {
      const box = bboxOf(atom);
      const x0 = Math.floor(box[0] / CELL);
      const y0 = Math.floor(box[1] / CELL);
      const x1 = Math.floor(box[2] / CELL);
      const y1 = Math.floor(box[3] / CELL);
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          const key = `${x},${y}`;
          const list = this.cells.get(key) ?? [];
          list.push(index);
          this.cells.set(key, list);
        }
      }
    });
  }

  private gather(x0: number, y0: number, x1: number, y1: number): Atom[] {
    const seen = new Set<number>();
    const out: Atom[] = [];
    const cx0 = Math.floor(x0 / CELL);
    const cy0 = Math.floor(y0 / CELL);
    const cx1 = Math.floor(x1 / CELL);
    const cy1 = Math.floor(y1 / CELL);
    for (let x = cx0; x <= cx1; x++) {
      for (let y = cy0; y <= cy1; y++) {
        for (const index of this.cells.get(`${x},${y}`) ?? []) {
          if (seen.has(index)) continue;
          seen.add(index);
          out.push(this.atoms[index]);
        }
      }
    }
    return out;
  }

  near(x: number, y: number, slop: number): Atom[] {
    return this.gather(x - slop, y - slop, x + slop, y + slop);
  }

  fullyInside(box: number[]): Atom[] {
    return this.gather(box[0], box[1], box[2], box[3]).filter((atom) => {
      const b = bboxOf(atom);
      return b[0] >= box[0] && b[1] >= box[1] && b[2] <= box[2] && b[3] <= box[3];
    });
  }
}

function segDist(ax: number, ay: number, bx: number, by: number, x: number, y: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const len = vx * vx + vy * vy;
  if (len <= 1e-12) return Math.hypot(x - ax, y - ay);
  let t = ((x - ax) * vx + (y - ay) * vy) / len;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (ax + t * vx), y - (ay + t * vy));
}

function inPoly(pts: number[][], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const yi = pts[i][1];
    const yj = pts[j][1];
    if (yi > y !== yj > y) {
      const xi = pts[i][0];
      const xj = pts[j][0];
      if (x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-18) + xi) inside = !inside;
    }
  }
  return inside;
}

export function distToAtom(atom: Atom, x: number, y: number): number {
  const pts = atom.points;
  if (atom.kind === "text") {
    const b = bboxOf(atom);
    const dx = Math.max(b[0] - x, 0, x - b[2]);
    const dy = Math.max(b[1] - y, 0, y - b[3]);
    return Math.hypot(dx, dy);
  }
  if (atom.kind === "fill" && pts.length >= 3 && inPoly(pts, x, y)) return 0;
  if (pts.length < 2) return Number.POSITIVE_INFINITY;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < pts.length; i++) {
    best = Math.min(best, segDist(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], x, y));
  }
  return best;
}

function span(atom: Atom): number {
  const b = bboxOf(atom);
  return Math.max(b[2] - b[0], b[3] - b[1]);
}

/** A point on `atom` as far as possible from every other mark.

Clicking an endpoint or a crossing selects the wrong member: witnesses,
ticks, and dimension lines meet at one point. */
export function isolatedPoint(atom: Atom, atoms: Atom[]): [number, number] {
  const pts = atom.points;
  const candidates: [number, number][] = [];
  if (atom.kind === "text" || pts.length < 2) {
    const b = bboxOf(atom);
    return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
  }
  for (let i = 1; i < pts.length; i++) {
    for (const t of [0.25, 0.5, 0.75]) {
      candidates.push([
        pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t,
        pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t,
      ]);
    }
  }
  let best = candidates[0];
  let bestScore = -1;
  for (const candidate of candidates) {
    let nearest = Number.POSITIVE_INFINITY;
    for (const other of atoms) {
      if (other.atom_id === atom.atom_id) continue;
      nearest = Math.min(nearest, distToAtom(other, candidate[0], candidate[1]));
    }
    if (nearest > bestScore) {
      bestScore = nearest;
      best = candidate;
    }
  }
  return best;
}

function outlineDist(atom: Atom, x: number, y: number): number {
  const pts = atom.points;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < pts.length; i++) {
    best = Math.min(best, segDist(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], x, y));
  }
  return best;
}

/** Every mark under the cursor, the one a labeler most likely means first.

A drawn line near the cursor beats a fill. A fill's inside comes last: CAD
exports lay white fills under furniture and whole rooms to mask hatching, and
those cover the lines a labeler is aiming at. */
export function pickAll(index: GridIndex, x: number, y: number, slop: number): Atom[] {
  const ranked: { atom: Atom; tier: number; dist: number; span: number }[] = [];
  for (const atom of index.near(x, y, slop)) {
    let tier = 0;
    let dist: number;
    if (atom.kind === "fill") {
      dist = outlineDist(atom, x, y);
      tier = 1;
      if (dist > slop && atom.points.length >= 3 && inPoly(atom.points, x, y)) {
        tier = 2;
        dist = 0;
      }
    } else {
      dist = distToAtom(atom, x, y);
    }
    if (dist > slop) continue;
    ranked.push({ atom, tier, dist, span: span(atom) });
  }
  ranked.sort((a, b) => a.tier - b.tier || a.dist - b.dist || a.span - b.span);
  return ranked.map((entry) => entry.atom);
}

export function pick(index: GridIndex, x: number, y: number, slop: number): Atom | null {
  return pickAll(index, x, y, slop)[0] ?? null;
}

export function clampZoom(z: number): number {
  return Math.min(64, Math.max(0.02, z));
}

export function fitCamera(width: number, height: number, viewW: number, viewH: number): Camera {
  const z = clampZoom(Math.min(viewW / Math.max(width, 1), viewH / Math.max(height, 1)) * 0.96);
  return { x: (viewW - width * z) / 2, y: (viewH - height * z) / 2, z };
}

export function frameBox(box: number[], viewW: number, viewH: number, pad = 1.6): Camera {
  const size = Math.max(box[2] - box[0], box[3] - box[1], 1);
  const z = clampZoom(Math.min(viewW, viewH) / (size * pad));
  const cx = (box[0] + box[2]) / 2;
  const cy = (box[1] + box[3]) / 2;
  return { x: viewW / 2 - cx * z, y: viewH / 2 - cy * z, z };
}

export function zoomAbout(cam: Camera, z: number, sx: number, sy: number): Camera {
  const nz = clampZoom(z);
  const k = nz / cam.z;
  return { x: sx - (sx - cam.x) * k, y: sy - (sy - cam.y) * k, z: nz };
}

export function screenToWorld(cam: Camera, sx: number, sy: number): { x: number; y: number } {
  return { x: (sx - cam.x) / cam.z, y: (sy - cam.y) / cam.z };
}

export function worldToScreen(cam: Camera, wx: number, wy: number): { x: number; y: number } {
  return { x: wx * cam.z + cam.x, y: wy * cam.z + cam.y };
}

export function strokeAtom(ctx: CanvasRenderingContext2D, atom: Atom, color: string, worldWidth: number): void {
  const pts = atom.points;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = worldWidth;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (atom.kind === "text") {
    const b = bboxOf(atom);
    ctx.strokeRect(b[0], b[1], Math.max(b[2] - b[0], 0.4), Math.max(b[3] - b[1], 0.4));
    return;
  }
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  if (atom.kind === "fill" || atom.kind === "polyline") ctx.closePath();
  if (atom.kind === "fill") {
    ctx.globalAlpha = 0.35;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.stroke();
}

/** Size the bitmap only when the stage changed. Assigning width clears it. */
export function canvasContext(canvas: HTMLCanvasElement, stage: HTMLElement): CanvasRenderingContext2D | null {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  const bw = Math.max(1, Math.floor(w * dpr));
  const bh = Math.max(1, Math.floor(h * dpr));
  const resized = canvas.width !== bw || canvas.height !== bh;
  if (resized) {
    canvas.width = bw;
    canvas.height = bh;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (!resized) ctx.clearRect(0, 0, w, h);
  return ctx;
}

export function applyCamera(ctx: CanvasRenderingContext2D, cam: Camera, cropW: number, cropH: number): void {
  ctx.save();
  ctx.translate(cam.x, cam.y);
  ctx.scale(cam.z, cam.z);
  ctx.beginPath();
  ctx.rect(0, 0, cropW, cropH);
  ctx.clip();
}

export function paintStatic(
  canvas: HTMLCanvasElement,
  stage: HTMLElement,
  atoms: Atom[],
  cam: Camera,
  cropW: number,
  cropH: number,
  underlay: HTMLImageElement | null,
): void {
  const ctx = canvasContext(canvas, stage);
  if (!ctx) return;
  ctx.fillStyle = "#d6d3d1";
  ctx.fillRect(0, 0, stage.clientWidth, stage.clientHeight);
  applyCamera(ctx, cam, cropW, cropH);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, cropW, cropH);
  if (underlay) ctx.drawImage(underlay, 0, 0, cropW, cropH);
  const hairline = 1 / cam.z;
  for (const atom of atoms) {
    strokeAtom(ctx, atom, atom.color || "#222", Math.max(atom.lineweight || 0, hairline));
  }
  ctx.restore();
}

export const PALETTE = ["#c2410c", "#0369a1", "#15803d", "#7c3aed", "#b45309", "#be123c", "#0f766e", "#4d7c0f"];

export const SELECTION_COLOR = "#1d4ed8";
export const HOVER_COLOR = "#0f766e";
export const SEED_COLOR = "#ea580c";

/** Apply one pick gesture to a member set. */
export function applyPick(members: string[], ids: string[], mode: "toggle" | "add" | "remove"): string[] {
  const out = new Set(members);
  for (const id of ids) {
    if (mode === "add") out.add(id);
    else if (mode === "remove") out.delete(id);
    else if (out.has(id)) out.delete(id);
    else out.add(id);
  }
  return [...out];
}

/** Atoms from task data: an array, or a document `{atoms, bbox?, seed_atom_id?}`. */
export function readAtomsDocument(doc: unknown): { atoms: Atom[]; bbox: number[] | null; seed: string | null } {
  if (Array.isArray(doc)) return { atoms: doc as Atom[], bbox: null, seed: null };
  if (doc && typeof doc === "object" && Array.isArray((doc as { atoms?: unknown }).atoms)) {
    const body = doc as { atoms: Atom[]; bbox?: number[]; seed_atom_id?: string };
    return { atoms: body.atoms, bbox: body.bbox ?? null, seed: body.seed_atom_id ?? null };
  }
  throw new Error("Drawing value must be an atoms array or an object with an atoms array");
}
