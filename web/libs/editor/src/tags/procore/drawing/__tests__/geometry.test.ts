import {
  type Atom,
  GridIndex,
  applyPick,
  fitCamera,
  isolatedPoint,
  localize,
  pick,
  pickAll,
  readAtomsDocument,
  screenToWorld,
  worldToScreen,
  zoomAbout,
} from "../geometry";

const line = (id: string, points: number[][]): Atom => ({ atom_id: id, kind: "line", points });

const atoms: Atom[] = [
  line("path:0:0", [
    [0, 0],
    [100, 0],
  ]),
  line("path:1:0", [
    [0, 10],
    [100, 10],
  ]),
  {
    atom_id: "path:2:0",
    kind: "fill",
    points: [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ],
  },
  {
    atom_id: "text:0",
    kind: "text",
    points: [
      [40, 40],
      [60, 50],
    ],
  },
];

describe("GridIndex", () => {
  const index = new GridIndex(atoms);

  it("finds marks near a point", () => {
    const ids = index.near(50, 1, 2).map((atom) => atom.atom_id);
    expect(ids).toEqual(expect.arrayContaining(["path:0:0", "path:2:0"]));
  });

  it("returns only marks fully inside a box", () => {
    const ids = index.fullyInside([-1, -1, 101, 11]).map((atom) => atom.atom_id);
    expect(ids.sort()).toEqual(["path:0:0", "path:1:0"]);
  });
});

describe("pick", () => {
  const index = new GridIndex(atoms);

  it("prefers a drawn line over the fill under it", () => {
    expect(pick(index, 50, 0.5, 3)?.atom_id).toBe("path:0:0");
  });

  it("puts a fill's inside last", () => {
    const ids = pickAll(index, 50, 45, 3).map((atom) => atom.atom_id);
    expect(ids).toEqual(["text:0", "path:2:0"]);
  });

  it("misses when nothing is within the slop", () => {
    expect(pick(index, 50, 150, 3)).toBeNull();
  });
});

describe("applyPick", () => {
  it("toggles, adds, and removes", () => {
    expect(applyPick(["a"], ["a", "b"], "toggle").sort()).toEqual(["b"]);
    expect(applyPick(["a"], ["a", "b"], "add").sort()).toEqual(["a", "b"]);
    expect(applyPick(["a", "b"], ["a"], "remove")).toEqual(["b"]);
  });
});

describe("readAtomsDocument", () => {
  it("accepts a bare array", () => {
    expect(readAtomsDocument(atoms)).toEqual({ atoms, bbox: null, seed: null });
  });

  it("accepts a document with bbox and seed", () => {
    const doc = { atoms, bbox: [0, 0, 10, 10], seed_atom_id: "path:0:0" };
    expect(readAtomsDocument(doc)).toEqual({ atoms, bbox: [0, 0, 10, 10], seed: "path:0:0" });
  });

  it("rejects anything else", () => {
    expect(() => readAtomsDocument({ marks: [] })).toThrow();
  });
});

describe("camera", () => {
  it("round-trips screen and world coordinates", () => {
    const cam = zoomAbout(fitCamera(612, 792, 800, 600), 3, 120, 80);
    const screen = worldToScreen(cam, 200, 300);
    const world = screenToWorld(cam, screen.x, screen.y);
    expect(world.x).toBeCloseTo(200);
    expect(world.y).toBeCloseTo(300);
  });
});

describe("localize and isolatedPoint", () => {
  it("shifts marks to the crop origin without changing ids", () => {
    const [first] = localize(atoms, 10, 5);
    expect(first.atom_id).toBe("path:0:0");
    expect(first.points[0]).toEqual([-10, -5]);
  });

  it("picks a spot on the mark away from its neighbours", () => {
    const index = new GridIndex(atoms);
    const [x, y] = isolatedPoint(atoms[0], atoms);
    expect(pick(index, x, y, 1)?.atom_id).toBe("path:0:0");
  });
});
