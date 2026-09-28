import { isAlive, types } from "mobx-state-tree";

import { AreaMixin } from "../../../mixins/AreaMixin";
import NormalizationMixin from "../../../mixins/Normalization";
import RegionsMixin from "../../../mixins/Regions";
import { DrawingModel } from "./Drawing";
import { PALETTE, unionBox } from "./geometry";

const Model = types
  .model("MarkSelectionRegionModel", {
    type: "markselectionregion",
    object: types.late(() => types.reference(DrawingModel)),
    member_atom_ids: types.array(types.string),
  })
  .volatile(() => ({
    hideable: true,
  }))
  .views((self) => ({
    get parent() {
      return isAlive(self) ? self.object : null;
    },

    get memberCount() {
      return self.member_atom_ids.length;
    },

    has(atomId) {
      return self.member_atom_ids.includes(atomId);
    },

    get color() {
      const index = self.region_index ?? (self.object?.drawingRegions.indexOf(self) ?? 0) + 1;
      return PALETTE[(Math.max(index, 1) - 1) % PALETTE.length];
    },

    /** Crop-local extent of the members, in points. */
    get bboxCoords() {
      const byId = self.object?.byId;
      const atoms = byId ? self.member_atom_ids.map((id) => byId.get(id)).filter(Boolean) : [];
      const box = unionBox(atoms);
      if (!box) return null;
      return { left: box[0], top: box[1], right: box[2], bottom: box[3] };
    },
  }))
  .actions((self) => ({
    setMembers(ids) {
      self.member_atom_ids = ids;
    },

    /**
     * @example
     * {
     *   "value": {
     *     "member_atom_ids": ["path:16:0", "path:17:0"]
     *   }
     * }
     * @typedef {Object} MarkSelectionRegionResult
     * @property {Object} value
     * @property {string[]} value.member_atom_ids ids of the selected marks, as given in the task's atoms
     */

    /**
     * @return {MarkSelectionRegionResult}
     */
    serialize() {
      return {
        value: {
          member_atom_ids: [...self.member_atom_ids].sort(),
        },
      };
    },
  }));

const MarkSelectionRegionModel = types.compose(
  "MarkSelectionRegionModel",
  RegionsMixin,
  AreaMixin,
  NormalizationMixin,
  Model,
);

export { MarkSelectionRegionModel };
