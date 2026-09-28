import { autorun, type IReactionDisposer } from "mobx";

import {
  type Atom,
  type Camera,
  type GridIndex,
  HOVER_COLOR,
  SEED_COLOR,
  SELECTION_COLOR,
  applyCamera,
  bboxOf,
  canvasContext,
  fitCamera,
  frameBox,
  insideCrop,
  isolatedPoint,
  paintStatic,
  pick,
  pickAll,
  screenToWorld,
  strokeAtom,
  worldToScreen,
  zoomAbout,
} from "./geometry";

type Region = {
  id: string;
  member_atom_ids: string[];
  hidden: boolean;
  highlighted: boolean;
  color: string;
};

/** The parts of the Drawing model the canvas reads and calls. */
export type DrawingItem = {
  atoms: Atom[];
  byId: Map<string, Atom>;
  index: GridIndex;
  cropW: number;
  cropH: number;
  underlayUrl: string | null;
  seedAtomId: string | null;
  underlayOn: boolean;
  seedOn: boolean;
  zoomTool: boolean;
  drawingRegions: Region[];
  selectedRegion: Region | null;
  editingIds: string[];
  pending: string[];
  canEdit: boolean;
  applyPick(ids: string[], mode: "toggle" | "add" | "remove"): void;
  addObject(): unknown;
  clearPending(): void;
  toggleUnderlay(): void;
  toggleSeed(): void;
  setZoomTool(on: boolean): void;
  selectRegionForAtom(atomId: string): unknown;
};

export type DrawingElements = {
  stage: HTMLElement;
  staticCanvas: HTMLCanvasElement;
  dynamicCanvas: HTMLCanvasElement;
  marquee: HTMLElement;
};

export type DrawingStatus = {
  zoom: number;
  stackSize: number;
  stackAt: number;
};

type Drag = { kind: "pan" | "box"; x: number; y: number; sx: number; sy: number };

const PICK_SLOP_PX = 6;
const CLICK_PX = 5;
const JITTER_PX = 3;

export class DrawingCanvas {
  private cam: Camera;
  private underlay: HTMLImageElement | null = null;
  private hover: string | null = null;
  private stack: Atom[] = [];
  private stackAt = 0;
  private stackPoint: { x: number; y: number } | null = null;
  private drag: Drag | null = null;
  private space = false;
  private pointerInside = false;
  private pulseUntil = 0;
  private paintId = 0;
  private paintStaticToo = false;
  private readonly abort = new AbortController();
  private readonly disposers: IReactionDisposer[] = [];
  private readonly resize: ResizeObserver | null = null;

  constructor(
    private readonly item: DrawingItem,
    private readonly els: DrawingElements,
    private readonly onStatus: (status: DrawingStatus) => void,
  ) {
    this.cam = this.fitted();
    this.bindEvents();
    if (typeof ResizeObserver !== "undefined") {
      this.resize = new ResizeObserver(() => this.schedulePaint(true));
      this.resize.observe(els.stage);
    }
    this.disposers.push(
      autorun(() => {
        if (item.underlayOn) this.ensureUnderlay();
        this.schedulePaint(true);
      }),
      autorun(() => {
        // Read everything the dynamic layer draws so MobX repaints when it changes.
        for (const region of item.drawingRegions) {
          void region.member_atom_ids.length;
          void region.hidden;
          void region.highlighted;
          void region.color;
        }
        void item.selectedRegion;
        void item.editingIds;
        void item.seedOn;
        this.schedulePaint(false);
      }),
    );
    this.emitStatus();
  }

  destroy(): void {
    this.abort.abort();
    this.disposers.forEach((dispose) => dispose());
    this.resize?.disconnect();
    if (this.paintId) cancelAnimationFrame(this.paintId);
  }

  fit(): void {
    this.cam = this.fitted();
    this.schedulePaint(true);
  }

  showSeed(): void {
    const seed = this.item.seedAtomId ? this.item.byId.get(this.item.seedAtomId) : undefined;
    if (!seed) return;
    const b = bboxOf(seed);
    const size = Math.max(b[2] - b[0], b[3] - b[1], Math.min(this.item.cropW, this.item.cropH) * 0.35);
    const cx = (b[0] + b[2]) / 2;
    const cy = (b[1] + b[3]) / 2;
    const box = [cx - size / 2, cy - size / 2, cx + size / 2, cy + size / 2];
    this.cam = frameBox(box, this.els.stage.clientWidth, this.els.stage.clientHeight);
    this.pulseUntil = performance.now() + 1400;
    this.schedulePaint(true);
  }

  /** Viewport point of a spot on the mark that no other mark is near. For tests. */
  clientPoint(atomId: string): { x: number; y: number } | null {
    const atom = this.item.byId.get(atomId);
    if (!atom) return null;
    const [wx, wy] = isolatedPoint(atom, this.item.atoms);
    const screen = worldToScreen(this.cam, wx, wy);
    const rect = this.els.dynamicCanvas.getBoundingClientRect();
    return { x: rect.left + screen.x, y: rect.top + screen.y };
  }

  private fitted(): Camera {
    const { stage } = this.els;
    return fitCamera(this.item.cropW, this.item.cropH, stage.clientWidth, stage.clientHeight);
  }

  private emitStatus(): void {
    this.onStatus({ zoom: this.cam.z, stackSize: this.stack.length, stackAt: this.stackAt });
  }

  private ensureUnderlay(): void {
    if (this.underlay || !this.item.underlayUrl) return;
    const image = new Image();
    image.onload = () => this.schedulePaint(true);
    image.onerror = () => {
      this.underlay = null;
    };
    image.src = this.item.underlayUrl;
    this.underlay = image;
  }

  private schedulePaint(includeStatic: boolean): void {
    if (this.abort.signal.aborted) return;
    // The camera moved, so the marks under the cursor changed.
    if (includeStatic) this.stackPoint = null;
    this.paintStaticToo = this.paintStaticToo || includeStatic;
    if (this.paintId) return;
    this.paintId = requestAnimationFrame(() => {
      this.paintId = 0;
      if (this.paintStaticToo) {
        this.paintStaticToo = false;
        this.redrawStatic();
      }
      this.redrawDynamic();
    });
  }

  private redrawStatic(): void {
    const { item, els } = this;
    const underlay = item.underlayOn && this.underlay?.complete ? this.underlay : null;
    paintStatic(els.staticCanvas, els.stage, item.atoms, this.cam, item.cropW, item.cropH, underlay);
  }

  private redrawDynamic(): void {
    const { item, els, cam } = this;
    const ctx = canvasContext(els.dynamicCanvas, els.stage);
    if (!ctx) return;
    applyCamera(ctx, cam, item.cropW, item.cropH);
    const hair = 2.2 / cam.z;
    const selected = item.selectedRegion;
    for (const region of item.drawingRegions) {
      if (region.hidden || region === selected) continue;
      const width = region.highlighted ? hair * 2 : hair;
      for (const id of region.member_atom_ids) {
        const atom = item.byId.get(id);
        if (atom) strokeAtom(ctx, atom, region.color, width);
      }
    }
    const editing = new Set(item.editingIds);
    const now = performance.now();
    const pulsing = now < this.pulseUntil;
    const seed = item.seedAtomId ? item.byId.get(item.seedAtomId) : undefined;
    // Drawn under the selection; once selected, the selection style takes over.
    if (seed && (pulsing || (item.seedOn && !editing.has(seed.atom_id)))) {
      const phase = pulsing ? 0.5 + 0.5 * Math.sin(now / 90) : 0;
      ctx.save();
      ctx.shadowColor = "rgba(234, 88, 12, 0.85)";
      ctx.shadowBlur = 6 + 12 * phase;
      strokeAtom(ctx, seed, SEED_COLOR, (8 + 4 * phase) / cam.z);
      ctx.restore();
    }
    for (const id of editing) {
      const atom = item.byId.get(id);
      if (atom) strokeAtom(ctx, atom, SELECTION_COLOR, hair);
    }
    if (this.hover && !editing.has(this.hover)) {
      const atom = item.byId.get(this.hover);
      if (atom) strokeAtom(ctx, atom, HOVER_COLOR, hair);
    }
    ctx.restore();
    if (pulsing) this.schedulePaint(false);
    this.emitStatus();
  }

  private pointOf(ev: MouseEvent): { x: number; y: number } {
    const rect = this.els.dynamicCanvas.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  private setHover(next: string | null): void {
    this.emitStatus();
    if (next === this.hover) return;
    this.hover = next;
    this.schedulePaint(false);
  }

  private bindEvents(): void {
    const { signal } = this.abort;
    const canvas = this.els.dynamicCanvas;
    canvas.addEventListener("pointerdown", (ev) => this.onPointerDown(ev), { signal });
    canvas.addEventListener("pointermove", (ev) => this.onPointerMove(ev), { signal });
    canvas.addEventListener("pointerup", (ev) => this.onPointerUp(ev), { signal });
    canvas.addEventListener("pointerenter", () => (this.pointerInside = true), { signal });
    canvas.addEventListener(
      "pointerleave",
      () => {
        this.pointerInside = false;
        this.stack = [];
        this.stackAt = 0;
        this.stackPoint = null;
        this.setHover(null);
      },
      { signal },
    );
    canvas.addEventListener("contextmenu", (ev) => ev.preventDefault(), { signal });
    canvas.addEventListener("wheel", (ev) => this.onWheel(ev), { passive: false, signal });
    window.addEventListener("keydown", (ev) => this.onKeyDown(ev), { signal });
    window.addEventListener(
      "keyup",
      (ev) => {
        if (ev.key === " ") this.space = false;
      },
      { signal },
    );
  }

  private capture(ev: PointerEvent): void {
    try {
      this.els.dynamicCanvas.setPointerCapture(ev.pointerId);
    } catch {
      // Throws for pointers that are no longer active, including synthetic events.
    }
  }

  private onPointerDown(ev: PointerEvent): void {
    const p = this.pointOf(ev);
    if (ev.button === 1 || ev.button === 2 || this.space) {
      this.drag = { kind: "pan", x: this.cam.x, y: this.cam.y, sx: p.x, sy: p.y };
      this.capture(ev);
      return;
    }
    if (ev.button !== 0) return;
    this.drag = { kind: "box", x: p.x, y: p.y, sx: p.x, sy: p.y };
    this.capture(ev);
  }

  private onPointerMove(ev: PointerEvent): void {
    const p = this.pointOf(ev);
    const { drag, item } = this;
    if (!drag) {
      // Hold the stack still for small jitters so Tab does not reset mid-cycle.
      if (this.stackPoint && Math.hypot(p.x - this.stackPoint.x, p.y - this.stackPoint.y) < JITTER_PX) return;
      const world = screenToWorld(this.cam, p.x, p.y);
      this.stack = insideCrop(world.x, world.y, item.cropW, item.cropH)
        ? pickAll(item.index, world.x, world.y, PICK_SLOP_PX / this.cam.z)
        : [];
      this.stackAt = 0;
      this.stackPoint = p;
      this.setHover(this.stack[0]?.atom_id ?? null);
      return;
    }
    if (drag.kind === "pan") {
      this.cam = { ...this.cam, x: drag.x + (p.x - drag.sx), y: drag.y + (p.y - drag.sy) };
      this.schedulePaint(true);
      return;
    }
    const box = this.els.marquee;
    box.hidden = false;
    box.style.left = `${Math.min(drag.sx, p.x)}px`;
    box.style.top = `${Math.min(drag.sy, p.y)}px`;
    box.style.width = `${Math.abs(p.x - drag.sx)}px`;
    box.style.height = `${Math.abs(p.y - drag.sy)}px`;
  }

  private onPointerUp(ev: PointerEvent): void {
    const start = this.drag;
    if (!start) return;
    this.drag = null;
    this.els.marquee.hidden = true;
    const p = this.pointOf(ev);
    const moved = Math.hypot(p.x - start.sx, p.y - start.sy);
    if (start.kind === "pan") return;
    const { item } = this;
    if (item.zoomTool && moved >= 8) {
      const a = screenToWorld(this.cam, start.sx, start.sy);
      const b = screenToWorld(this.cam, p.x, p.y);
      const box = [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)];
      this.cam = frameBox(box, this.els.stage.clientWidth, this.els.stage.clientHeight, 1.04);
      item.setZoomTool(false);
      this.schedulePaint(true);
      return;
    }
    if (moved < CLICK_PX) {
      this.onClick(ev, p);
      return;
    }
    const a = screenToWorld(this.cam, start.sx, start.sy);
    const b = screenToWorld(this.cam, p.x, p.y);
    const box = [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)];
    const hits = item.index.fullyInside(box).map((atom) => atom.atom_id);
    item.applyPick(hits, ev.altKey ? "remove" : "add");
  }

  private onClick(ev: PointerEvent, p: { x: number; y: number }): void {
    const { item } = this;
    const world = screenToWorld(this.cam, p.x, p.y);
    if (!insideCrop(world.x, world.y, item.cropW, item.cropH)) return;
    const held = this.stackPoint && Math.hypot(p.x - this.stackPoint.x, p.y - this.stackPoint.y) < JITTER_PX;
    const hit = held ? this.stack[this.stackAt] : pick(item.index, world.x, world.y, PICK_SLOP_PX / this.cam.z);
    if (!hit) return;
    if (ev.ctrlKey || ev.metaKey) {
      item.selectRegionForAtom(hit.atom_id);
      return;
    }
    item.applyPick([hit.atom_id], "toggle");
  }

  private onWheel(ev: WheelEvent): void {
    ev.preventDefault();
    const p = this.pointOf(ev);
    if (ev.ctrlKey || ev.metaKey) {
      this.cam = zoomAbout(this.cam, this.cam.z * Math.exp(-ev.deltaY * 0.001), p.x, p.y);
    } else {
      this.cam = { ...this.cam, x: this.cam.x - ev.deltaX, y: this.cam.y - ev.deltaY };
    }
    this.schedulePaint(true);
  }

  /** Drawing keys only fire while the pointer is over the canvas, so they don't fight the rest of the editor. */
  private onKeyDown(ev: KeyboardEvent): void {
    if (!this.pointerInside) return;
    const target = ev.target as HTMLElement | null;
    if (target?.matches?.("input, select, textarea, [contenteditable]")) return;
    if (ev.ctrlKey || ev.metaKey) return;
    const { item } = this;
    if (ev.key === "Tab" && this.stack.length > 1) {
      ev.preventDefault();
      const step = ev.shiftKey ? -1 : 1;
      this.stackAt = (this.stackAt + step + this.stack.length) % this.stack.length;
      this.setHover(this.stack[this.stackAt].atom_id);
      return;
    }
    if (ev.key === " ") {
      this.space = true;
      ev.preventDefault();
      return;
    }
    if (ev.altKey) return;
    switch (ev.key) {
      case "0":
        this.fit();
        break;
      case "a":
        item.addObject();
        break;
      case "z":
        item.setZoomTool(!item.zoomTool);
        break;
      case "i":
        item.toggleUnderlay();
        break;
      case "s":
        item.toggleSeed();
        break;
      case "Escape":
        item.clearPending();
        break;
      default:
        return;
    }
  }
}
