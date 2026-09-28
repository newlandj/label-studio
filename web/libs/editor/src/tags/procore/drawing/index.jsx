import { types } from "mobx-state-tree";
import { IconPolygonTool } from "@humansignal/icons";

import Registry from "../../../core/Registry";
import { DrawingModel, REGION_TYPE } from "./Drawing";
import { HtxDrawing } from "./HtxDrawing";
import { HtxMarkSelect, MarkSelectModel } from "./MarkSelect";
import { MarkSelectionRegionModel } from "./MarkSelectionRegion";

const RESULT_TYPE = "markselection";

MarkSelectionRegionModel.nodeView = {
  name: "Marks",
  icon: IconPolygonTool,
  getContent: (node) => (
    <span style={{ color: "#5a5a5a" }}>
      {node.memberCount} mark{node.memberCount === 1 ? "" : "s"}
    </span>
  ),
};

if (!Registry.models.drawing) {
  Registry.addCustomTag("Drawing", {
    tag: "Drawing",
    isObject: true,
    model: DrawingModel,
    view: HtxDrawing,
    region: MarkSelectionRegionModel,
    detector: (snapshot) => Array.isArray(snapshot?.value?.member_atom_ids) || snapshot?.type === REGION_TYPE,
  });

  Registry.addCustomTag("MarkSelect", {
    tag: "MarkSelect",
    model: MarkSelectModel,
    view: HtxMarkSelect,
    resultName: RESULT_TYPE,
    result: types.frozen(),
  });
}

export { DrawingModel, HtxDrawing, MarkSelectModel, MarkSelectionRegionModel, RESULT_TYPE };
