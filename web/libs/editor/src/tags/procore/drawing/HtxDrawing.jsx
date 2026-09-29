import { useEffect, useRef, useState } from "react";
import { inject, observer } from "mobx-react";

import { cn } from "../../../utils/bem";
import { DrawingCanvas } from "./DrawingCanvas";
import "./Drawing.scss";

const b = cn("procore-drawing");

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

const Toggle = ({ pressed, onClick, title, children, hidden = false }) =>
  hidden ? null : (
    <button
      type="button"
      className={b.elem("button").toClassName()}
      aria-pressed={pressed}
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  );

const Toolbar = observer(({ item, canvas, status }) => {
  const region = item.selectedRegion;
  const editing = item.editingIds.length;
  let note;
  if (region) note = `Editing object ${region.region_index ?? ""} · ${plural(editing, "mark")}`;
  else if (editing) note = `${plural(editing, "mark")} selected`;
  else note = "Click a mark, or drag a box around marks";

  return (
    <div className={b.elem("toolbar").toClassName()}>
      <Toggle title="Fit the crop (0)" onClick={() => canvas?.fit()}>
        Fit
      </Toggle>
      <Toggle pressed={item.zoomTool} title="Drag a box to zoom (z)" onClick={() => item.setZoomTool(!item.zoomTool)}>
        Zoom box
      </Toggle>
      <Toggle
        pressed={item.underlayOn}
        hidden={!item.underlayUrl}
        title="Show the rendered sheet under the marks (i)"
        onClick={() => item.toggleUnderlay()}
      >
        Underlay
      </Toggle>
      <Toggle
        pressed={item.seedOn}
        hidden={!item.seedAtomId}
        title="Highlight the seed mark (s)"
        onClick={() => item.toggleSeed()}
      >
        Seed
      </Toggle>
      <Toggle
        hidden={!item.seedAtomId}
        title={`Zoom to seed mark ${item.seedAtomId ?? ""}`}
        onClick={() => canvas?.showSeed()}
      >
        Show seed
      </Toggle>
      <span className={b.elem("zoom").toClassName()}>{Math.round(status.zoom * 100)}%</span>
      <span className={b.elem("spacer").toClassName()} />
      <span className={b.elem("note").toClassName()} data-count={editing}>
        {note}
      </span>
      {region ? (
        <button type="button" className={b.elem("button").toClassName()} onClick={() => item.annotation.unselectAll()}>
          Done
        </button>
      ) : (
        <button
          type="button"
          className={b.elem("button").mod({ primary: true }).toClassName()}
          disabled={!item.pending.length || !item.canEdit}
          title="Save the selected marks as one object (a)"
          onClick={() => item.addObject()}
        >
          Add object
        </button>
      )}
    </div>
  );
});

const HtxDrawing = inject("store")(
  observer(({ item }) => {
    const stageRef = useRef(null);
    const staticRef = useRef(null);
    const dynamicRef = useRef(null);
    const marqueeRef = useRef(null);
    const [canvas, setCanvas] = useState(null);
    const [status, setStatus] = useState({ zoom: 1, stackSize: 0, stackAt: 0 });
    const ready = item.loadState === "ready";

    useEffect(() => {
      if (!ready) return undefined;
      const controller = new DrawingCanvas(
        item,
        {
          stage: stageRef.current,
          staticCanvas: staticRef.current,
          dynamicCanvas: dynamicRef.current,
          marquee: marqueeRef.current,
        },
        (next) =>
          setStatus((prev) =>
            prev.zoom === next.zoom && prev.stackSize === next.stackSize && prev.stackAt === next.stackAt ? prev : next,
          ),
      );
      setCanvas(controller);
      window.__procoreDrawing = { clientPoint: (atomId) => controller.clientPoint(atomId) };
      return () => {
        controller.destroy();
        setCanvas(null);
        if (window.__procoreDrawing?.clientPoint) delete window.__procoreDrawing;
      };
    }, [item, ready, item.atoms]);

    return (
      <div className={b.toClassName()} data-testid="procore-drawing">
        <Toolbar item={item} canvas={canvas} status={status} />
        <div className={b.elem("stage").toClassName()} ref={stageRef} style={{ height: item.height }}>
          {item.loadState === "loading" && <div className={b.elem("message").toClassName()}>Loading marks…</div>}
          {item.loadState === "error" && (
            <div className={b.elem("message").mod({ error: true }).toClassName()}>{item.loadError}</div>
          )}
          <canvas className={b.elem("canvas").toClassName()} ref={staticRef} />
          <canvas
            className={b.elem("canvas").mod({ zoom: item.zoomTool }).toClassName()}
            ref={dynamicRef}
            data-testid="procore-drawing-canvas"
          />
          <div className={b.elem("marquee").toClassName()} ref={marqueeRef} hidden />
          {status.stackSize > 1 && (
            <div className={b.elem("hint").toClassName()}>
              {status.stackAt + 1} of {status.stackSize} here · Tab for next
            </div>
          )}
        </div>
      </div>
    );
  }),
);

export { HtxDrawing };
