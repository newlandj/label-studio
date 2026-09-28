import { useEffect, useRef, useState } from "react";
import { inject, observer } from "mobx-react";

import { DrawingCanvas } from "./DrawingCanvas";
import "./Drawing.scss";

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

const Toggle = ({ pressed, onClick, title, children, hidden = false }) =>
  hidden ? null : (
    <button type="button" className="procore-drawing__button" aria-pressed={pressed} title={title} onClick={onClick}>
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
    <div className="procore-drawing__toolbar">
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
      <span className="procore-drawing__zoom">{Math.round(status.zoom * 100)}%</span>
      <span className="procore-drawing__spacer" />
      <span className="procore-drawing__note" data-count={editing}>
        {note}
      </span>
      {region ? (
        <button type="button" className="procore-drawing__button" onClick={() => item.annotation.unselectAll()}>
          Done
        </button>
      ) : (
        <button
          type="button"
          className="procore-drawing__button procore-drawing__button--primary"
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
      <div className="procore-drawing" data-testid="procore-drawing">
        <Toolbar item={item} canvas={canvas} status={status} />
        <div className="procore-drawing__stage" ref={stageRef} style={{ height: item.height }}>
          {item.loadState === "loading" && <div className="procore-drawing__message">Loading marks…</div>}
          {item.loadState === "error" && (
            <div className="procore-drawing__message procore-drawing__message--error">{item.loadError}</div>
          )}
          <canvas className="procore-drawing__canvas" ref={staticRef} />
          <canvas
            className={`procore-drawing__canvas${item.zoomTool ? " procore-drawing__canvas--zoom" : ""}`}
            ref={dynamicRef}
            data-testid="procore-drawing-canvas"
          />
          <div className="procore-drawing__marquee" ref={marqueeRef} hidden />
          {status.stackSize > 1 && (
            <div className="procore-drawing__hint">
              {status.stackAt + 1} of {status.stackSize} here · Tab for next
            </div>
          )}
        </div>
      </div>
    );
  }),
);

export { HtxDrawing };
