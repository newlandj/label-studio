import "./flags";
import "../../index";

if (typeof globalThis.structuredClone === "undefined") {
  globalThis.structuredClone = (obj) => JSON.parse(JSON.stringify(obj));
}

jest.mock("keymaster", () => {
  const keymaster = () => {};
  keymaster.unbind = () => {};
  keymaster.setScope = () => {};
  return { __esModule: true, default: keymaster };
});

import "../../../visual/View";
import "../../../control/Choices";
import "../../../control/Choice";
import AppStore from "../../../../stores/AppStore";

const CONFIG = `
<View>
  <Drawing name="drawing" value="$atoms" seed="$seed_atom_id" />
  <MarkSelect name="marks" toName="drawing" />
  <Choices name="completeness" toName="drawing" perRegion="true">
    <Choice value="whole" />
    <Choice value="fragment" />
  </Choices>
</View>`;

const ATOMS = [
  {
    atom_id: "path:16:0",
    kind: "line",
    points: [
      [200, 272],
      [200, 320],
    ],
  },
  {
    atom_id: "path:17:0",
    kind: "polyline",
    points: [
      [200, 272],
      [248, 320],
    ],
  },
  {
    atom_id: "text:3",
    kind: "text",
    points: [
      [10, 10],
      [30, 20],
    ],
  },
];

const env = () => ({
  events: { hasEvent: jest.fn(() => false), invoke: jest.fn(), invokeFirst: jest.fn() },
  messages: {},
  settings: {},
});

async function createStore(result = []) {
  const store = AppStore.create(
    {
      config: CONFIG,
      task: { id: 1, data: JSON.stringify({ atoms: ATOMS, seed_atom_id: "path:16:0" }) },
      interfaces: ["basic", "side-column"],
    },
    env(),
  );
  store.initializeStore({});
  const annotation = store.annotationStore.addAnnotation({ userGenerate: true });
  store.annotationStore.selectAnnotation(annotation.id);
  if (result.length) annotation.deserializeResults(result);
  const drawing = annotation.names.get("drawing");
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { store, annotation, drawing };
}

describe("Drawing and MarkSelect", () => {
  it("loads inline atoms and the seed", async () => {
    const { drawing } = await createStore();
    expect(drawing.loadState).toBe("ready");
    expect(drawing.atoms).toHaveLength(3);
    expect(drawing.seedAtomId).toBe("path:16:0");
    expect(drawing.markControl?.name).toBe("marks");
  });

  it("builds an object from picks and serializes the member ids", async () => {
    const { annotation, drawing } = await createStore();
    drawing.applyPick(["path:17:0"], "toggle");
    drawing.applyPick(["path:16:0", "path:17:0"], "add");
    expect([...drawing.pending].sort()).toEqual(["path:16:0", "path:17:0"]);

    const area = drawing.addObject();
    expect(area.type).toBe("markselectionregion");
    expect(drawing.pending).toEqual([]);
    expect(annotation.highlightedNode).toBe(area);
    expect(drawing.selectedRegion).toBe(area);

    const [result] = annotation.serializeAnnotation();
    expect(result).toMatchObject({
      from_name: "marks",
      to_name: "drawing",
      type: "markselection",
      value: { member_atom_ids: ["path:16:0", "path:17:0"] },
    });
  });

  it("edits the selected object's members and drops it when emptied", async () => {
    const { annotation, drawing } = await createStore();
    drawing.setPending(["path:16:0"]);
    const area = drawing.addObject();
    drawing.applyPick(["text:3"], "toggle");
    expect([...area.member_atom_ids].sort()).toEqual(["path:16:0", "text:3"]);
    drawing.applyPick(["path:16:0", "text:3"], "remove");
    expect(annotation.regions).toHaveLength(0);
  });

  it("attaches per-region choices to the object", async () => {
    const { annotation, drawing } = await createStore();
    drawing.setPending(["path:16:0", "path:17:0"]);
    const area = drawing.addObject();
    const choices = annotation.names.get("completeness");
    choices.findLabel("whole").setSelected(true);
    area.setValue(choices);

    const results = annotation.serializeAnnotation();
    const types = results.map((r) => r.type).sort();
    expect(types).toEqual(["choices", "markselection"]);
    const choice = results.find((r) => r.type === "choices");
    expect(choice.id).toBe(results.find((r) => r.type === "markselection").id);
    expect(choice.value.choices).toEqual(["whole"]);
  });

  it("round-trips a saved result into the same region", async () => {
    const saved = [
      {
        id: "r1",
        from_name: "marks",
        to_name: "drawing",
        type: "markselection",
        value: { member_atom_ids: ["path:16:0", "path:17:0"] },
      },
      {
        id: "r1",
        from_name: "completeness",
        to_name: "drawing",
        type: "choices",
        value: { member_atom_ids: ["path:16:0", "path:17:0"], choices: ["fragment"] },
      },
    ];
    const { annotation, drawing } = await createStore(saved);
    expect(annotation.regions).toHaveLength(1);
    const [region] = drawing.drawingRegions;
    expect(region.type).toBe("markselectionregion");
    expect(region.results).toHaveLength(2);
    annotation.selectArea(region);
    expect(drawing.selectedRegion).toBe(region);
    expect(annotation.regionStore.selection.selected.size).toBe(1);

    const serialized = annotation.serializeAnnotation();
    expect(serialized.find((r) => r.type === "markselection").value.member_atom_ids).toEqual([
      "path:16:0",
      "path:17:0",
    ]);
    expect(serialized.find((r) => r.type === "choices").value.choices).toEqual(["fragment"]);
  });
});
