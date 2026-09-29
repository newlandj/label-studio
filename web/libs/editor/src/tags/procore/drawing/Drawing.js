import { getRoot, isAlive, types } from "mobx-state-tree";

import { AnnotationMixin } from "../../../mixins/AnnotationMixin";
import { parseValue } from "../../../utils/data";
import ObjectBase from "../../object/Base";
import { GridIndex, applyPick, extentOf, localize, readAtomsDocument } from "./geometry";

export const REGION_TYPE = "markselectionregion";

function readBox(raw) {
  if (!raw) return null;
  let value = raw;
  if (typeof value === "string") {
    const text = value.trim();
    value = text.startsWith("[") ? JSON.parse(text) : text.split(",");
  }
  if (!Array.isArray(value) || value.length !== 4) return null;
  const box = value.map(Number);
  return box.every(Number.isFinite) ? box : null;
}

async function loadDocument(raw) {
  if (typeof raw !== "string") return raw;
  const text = raw.trim();
  if (text.startsWith("[") || text.startsWith("{")) return JSON.parse(text);
  const res = await fetch(text);
  if (!res.ok) throw new Error(`Could not load atoms (${res.status})`);
  return res.json();
}

/**
 * The `Drawing` tag shows a crop of a vector drawing as its individual marks
 * ("atoms") so a labeler can select existing marks instead of drawing shapes.
 *
 * Each atom is `{atom_id, kind, points, color, lineweight}` in page points,
 * with a top-left origin. `kind` is `line`, `curve`, `polyline` (closed), `fill`, or `text`.
 * Pair it with `MarkSelect`.
 * @example
 * <View>
 *   <Drawing name="drawing" value="$atoms" underlay="$underlay" bbox="$bbox" seed="$seed_atom_id" />
 *   <MarkSelect name="marks" toName="drawing" />
 * </View>
 * <!-- {"data": {"atoms": "s3://bucket/crops/c0.json", "underlay": "s3://bucket/crops/c0.png", "bbox": [0, 0, 612, 792]}} -->
 * @name Drawing
 * @regions MarkSelectionRegion
 * @param {string} name       - Name of the element
 * @param {string} value      - Atoms: an array, a JSON string, or a URL to a JSON document. The document may be the array or `{atoms, bbox, seed_atom_id}`
 * @param {string} [underlay] - Image of the same crop, drawn under the marks when toggled on
 * @param {string} [bbox]     - Crop `[x0, y0, x1, y1]` in page points. Defaults to the document's bbox, then to the atoms' extent
 * @param {string} [seed]     - Atom id to highlight as the seed mark
 * @param {string} [height=640px] - Height of the canvas
 */
const TagAttrs = types.model({
  value: types.maybeNull(types.string),
  underlay: types.maybeNull(types.string),
  bbox: types.maybeNull(types.string),
  seed: types.maybeNull(types.string),
  height: types.optional(types.string, "640px"),
});

const Model = types
  .model({
    type: "drawing",
  })
  .volatile(() => ({
    atoms: [],
    byId: new Map(),
    index: null,
    cropW: 1,
    cropH: 1,
    underlayUrl: null,
    seedAtomId: null,
    loadState: "idle",
    loadError: null,
    pending: [],
    underlayOn: false,
    seedOn: true,
    zoomTool: false,
    loadToken: 0,
  }))
  .views((self) => ({
    get store() {
      return getRoot(self);
    },

    get markControl() {
      return self.annotation?.toNames.get(self.name)?.find((tag) => tag.type === "markselect") ?? null;
    },

    get isReady() {
      return self.loadState === "ready" || self.loadState === "error";
    },

    get drawingRegions() {
      return self.regs.filter((region) => region.type === REGION_TYPE);
    },

    get selectedRegion() {
      const node = self.annotation?.highlightedNode;
      if (!node || !isAlive(node) || node.type !== REGION_TYPE || node.object !== self) return null;
      return node;
    },

    get isReadOnlyAnnotation() {
      const annotation = self.annotation;
      return !annotation || annotation.isReadOnly();
    },

    get canEdit() {
      if (self.isReadOnlyAnnotation || !self.markControl) return false;
      const region = self.selectedRegion;
      return region ? !region.isReadOnly() && !region.locked : true;
    },

    /** The members being edited: the selected region's, or the unsaved selection. */
    get editingIds() {
      return self.selectedRegion ? self.selectedRegion.member_atom_ids.slice() : self.pending;
    },

    regionsWith(atomId) {
      return self.drawingRegions.filter((region) => region.has(atomId));
    },
  }))
  .actions((self) => ({
    updateValue(store) {
      const data = store.task.dataObj;
      const raw = parseValue(self.value, data);
      const extras = {
        underlay: self.underlay ? parseValue(self.underlay, data) || null : null,
        bbox: self.bbox ? parseValue(self.bbox, data) || null : null,
        seed: self.seed ? parseValue(self.seed, data) || null : null,
      };
      const token = self.loadToken + 1;
      self.startLoad(token);
      loadDocument(raw)
        .then((doc) => isAlive(self) && self.finishLoad(token, doc, extras))
        .catch((err) => isAlive(self) && self.failLoad(token, err));
    },

    startLoad(token) {
      self.loadToken = token;
      self.loadState = "loading";
      self.loadError = null;
    },

    finishLoad(token, doc, extras) {
      if (token !== self.loadToken) return;
      try {
        const { atoms, bbox, seed } = readAtomsDocument(doc);
        const box = readBox(extras.bbox) ?? readBox(bbox) ?? [0, 0, ...extentOf(atoms).slice(2)];
        const local = localize(atoms, box[0], box[1]);
        self.atoms = local;
        self.byId = new Map(local.map((atom) => [atom.atom_id, atom]));
        self.index = new GridIndex(local);
        self.cropW = Math.max(box[2] - box[0], 1);
        self.cropH = Math.max(box[3] - box[1], 1);
        self.underlayUrl = extras.underlay;
        self.seedAtomId = extras.seed ?? seed ?? null;
        self.pending = [];
        self.loadState = "ready";
      } catch (err) {
        self.failLoad(token, err);
      }
    },

    failLoad(token, err) {
      if (token !== self.loadToken) return;
      self.loadState = "error";
      self.loadError = err instanceof Error ? err.message : String(err);
    },

    needsUpdate() {
      self.pending = [];
    },

    setPending(ids) {
      self.pending = ids;
    },

    clearPending() {
      self.pending = [];
    },

    toggleUnderlay() {
      self.underlayOn = !self.underlayOn;
    },

    toggleSeed() {
      self.seedOn = !self.seedOn;
    },

    setZoomTool(on) {
      self.zoomTool = on;
    },

    /** One click or box gesture. Edits the selected region, else the unsaved selection. */
    applyPick(ids, mode) {
      if (!ids.length || !self.canEdit) return;
      const region = self.selectedRegion;
      if (!region) {
        self.pending = applyPick(self.pending, ids, mode);
        return;
      }
      const next = applyPick(region.member_atom_ids, ids, mode);
      if (next.length) region.setMembers(next);
      else region.deleteRegion();
    },

    /** Save the unsaved selection as a new object and select it. */
    addObject() {
      const control = self.markControl;
      if (!control || !self.pending.length || self.isReadOnlyAnnotation) return null;
      const members = [...self.pending].sort();
      const area = self.annotation.createResult({ member_atom_ids: members }, {}, control, self);
      self.pending = [];
      if (area) self.annotation.selectArea(area);
      return area;
    },

    selectRegionForAtom(atomId) {
      const [region] = self.regionsWith(atomId);
      if (region) self.annotation.selectArea(region);
      return region ?? null;
    },
  }));

const DrawingModel = types.compose("DrawingModel", ObjectBase, AnnotationMixin, TagAttrs, Model);

export { DrawingModel };
