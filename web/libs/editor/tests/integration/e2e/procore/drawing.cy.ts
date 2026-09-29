import { LabelStudio } from "@humansignal/frontend-test/helpers/LSF";
import { floorplanAtoms, floorplanBbox, floorplanGold } from "../../data/procore/drawing";

const config = `
<View>
  <Drawing name="drawing" value="$atoms" bbox="$bbox" />
  <MarkSelect name="marks" toName="drawing" />
  <Choices name="completeness" toName="drawing" perRegion="true">
    <Choice value="whole" />
    <Choice value="fragment" />
  </Choices>
</View>`;

const canvas = () => cy.get("[data-testid=procore-drawing-canvas]");

function clickMark(atomId: string) {
  cy.window().then((win) => {
    const point = (win as any).__procoreDrawing?.clientPoint(atomId);
    expect(point, `a clickable spot on ${atomId}`).to.not.equal(null);
    canvas().then(($canvas) => {
      const rect = $canvas[0].getBoundingClientRect();
      canvas().click(point.x - rect.left, point.y - rect.top);
    });
  });
}

describe("Procore Drawing", () => {
  beforeEach(() => {
    LabelStudio.addFeatureFlagsOnPageLoad({ fflag_feat_front_bros_194_custom_tags_short: true });
    LabelStudio.params().config(config).data({ atoms: floorplanAtoms, bbox: floorplanBbox }).withResult([]).init();
    LabelStudio.waitForObjectsReady();
    cy.window().its("__procoreDrawing").should("exist");
  });

  it("stacks the interactive canvas over the static one", () => {
    canvas().should("have.css", "position", "absolute");
    cy.get("[data-testid=procore-drawing] canvas").then(($canvases) => {
      const [under, over] = [...$canvases].map((el) => el.getBoundingClientRect());
      expect(over.top).to.equal(under.top);
      expect(over.left).to.equal(under.left);
    });
  });

  it("saves the door's marks as one object", () => {
    for (const id of floorplanGold.door) clickMark(id);
    cy.contains("button", "Add object").click();

    LabelStudio.serialize().then((result) => {
      const marks = result.filter((r: any) => r.type === "markselect");
      expect(marks).to.have.length(1);
      expect(marks[0].value.member_atom_ids).to.deep.equal([...floorplanGold.door].sort());
    });
  });

  it("keeps separate objects separate", () => {
    for (const id of floorplanGold.door) clickMark(id);
    cy.contains("button", "Add object").click();
    cy.contains("button", "Done").click();
    for (const id of floorplanGold.window) clickMark(id);
    cy.contains("button", "Add object").click();

    LabelStudio.serialize().then((result) => {
      const members = result
        .filter((r: any) => r.type === "markselect")
        .map((r: any) => r.value.member_atom_ids)
        .sort();
      expect(members).to.deep.equal([[...floorplanGold.door].sort(), [...floorplanGold.window].sort()].sort());
    });
  });
});
