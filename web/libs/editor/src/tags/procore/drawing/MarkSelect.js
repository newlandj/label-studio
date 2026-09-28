import { types } from "mobx-state-tree";

import { AnnotationMixin } from "../../../mixins/AnnotationMixin";
import SeparatedControlMixin from "../../../mixins/SeparatedControlMixin";
import ControlBase from "../../control/Base";

/**
 * The `MarkSelect` tag turns on mark selection for a `Drawing`. Each object a
 * labeler adds is one region whose result is the ids of the marks they picked.
 *
 * Name and completeness are ordinary per-region `Choices` or `Taxonomy` tags
 * pointed at the same `Drawing`.
 * @example
 * <View>
 *   <Drawing name="drawing" value="$atoms" underlay="$underlay" seed="$seed_atom_id" />
 *   <MarkSelect name="marks" toName="drawing" />
 *   <Choices name="completeness" toName="drawing" perRegion="true" required="true">
 *     <Choice value="whole" />
 *     <Choice value="fragment" />
 *   </Choices>
 * </View>
 * @name MarkSelect
 * @param {string} name   - Name of the element
 * @param {string} toName - Name of the `Drawing` to select marks on
 */
const TagAttrs = types.model({
  toname: types.maybeNull(types.string),
});

const Model = types
  .model({
    type: "markselect",
  })
  .views(() => ({
    get resultType() {
      return "markselection";
    },

    get valueType() {
      return "markselection";
    },
  }));

const MarkSelectModel = types.compose(
  "MarkSelectModel",
  ControlBase,
  AnnotationMixin,
  SeparatedControlMixin,
  TagAttrs,
  Model,
);

const HtxMarkSelect = () => null;

export { HtxMarkSelect, MarkSelectModel };
