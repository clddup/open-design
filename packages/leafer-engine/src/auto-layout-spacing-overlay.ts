import type {
  DesignDocument,
  DesignNode,
  Transform,
} from "@opendesign/design-contracts";
import {
  effectivelyLockedForEditorOverlay,
  hasTranslationOnlyTransform,
  supportsAxisAlignedEditorOverlay,
} from "./editor-overlay-support.js";
import { getVisibleWorldTransform } from "./scene-node-transform.js";

const ROW_EPSILON = 0.000_001;
export const MAX_AUTO_LAYOUT_SPACING_CONTROLS = 512;

export type AutoLayoutSpacingHandleKind =
  | "padding-top"
  | "padding-right"
  | "padding-bottom"
  | "padding-left"
  | "gap"
  | "counter-gap";

export interface AutoLayoutSpacingHandleSpec {
  axis: "x" | "y";
  id: string;
  kind: AutoLayoutSpacingHandleKind;
  orientation: "horizontal" | "vertical";
  value: number;
  x: number;
  y: number;
}

export interface AutoLayoutSpacingOverlayPlan {
  fingerprint: string;
  frameId: string;
  frameSize: { height: number; width: number };
  handles: readonly AutoLayoutSpacingHandleSpec[];
  padding: { bottom: number; left: number; right: number; top: number };
  transform: Transform;
}

interface FlowChild {
  height: number;
  id: string;
  width: number;
  x: number;
  y: number;
}

interface FlowRow {
  bottom: number;
  children: FlowChild[];
  top: number;
}

export function createAutoLayoutSpacingOverlayPlan(
  document: DesignDocument,
  frameId: string | undefined,
): AutoLayoutSpacingOverlayPlan | null {
  const frame = frameId ? document.nodesById[frameId] : undefined;
  const autoLayout =
    frame?.kind === "frame" ? frame.properties.autoLayout : undefined;
  if (
    frame?.kind !== "frame" ||
    !autoLayout ||
    autoLayout.mode === "none" ||
    frame.size.width <= 0 ||
    frame.size.height <= 0 ||
    effectivelyLockedForEditorOverlay(document, frame.id)
  ) {
    return null;
  }
  const transform = getVisibleWorldTransform(document.nodesById, frame.id);
  if (!transform || !supportsAxisAlignedEditorOverlay(transform)) return null;

  const handles: AutoLayoutSpacingHandleSpec[] = paddingHandles(
    frame.id,
    frame.size,
    autoLayout.padding,
  );
  const children = flowChildren(document, frame.childIds);
  if (
    children &&
    children.length > 1 &&
    children.length <= MAX_AUTO_LAYOUT_SPACING_CONTROLS
  ) {
    if (autoLayout.mode === "horizontal") {
      if (autoLayout.wrap) {
        const rows = horizontalRows(children);
        if (autoLayout.primaryAlignment !== "space-between") {
          rows.forEach((row, rowIndex) => {
            handles.push(
              ...horizontalGapHandles(
                frame.id,
                row.children,
                autoLayout.gap,
                `row-${rowIndex}`,
              ),
            );
          });
        }
        if (
          autoLayout.wrap.counterAxisAlignContent !== "space-between" &&
          rows.length > 1
        ) {
          handles.push(
            ...counterGapHandles(
              frame.id,
              frame.size.width,
              rows,
              autoLayout.wrap.counterGap,
            ),
          );
        }
      } else if (autoLayout.primaryAlignment !== "space-between") {
        handles.push(
          ...horizontalGapHandles(frame.id, children, autoLayout.gap, "flow"),
        );
      }
    } else if (
      autoLayout.mode === "vertical" &&
      autoLayout.primaryAlignment !== "space-between"
    ) {
      handles.push(...verticalGapHandles(frame.id, children, autoLayout.gap));
    }
  }

  const plan = {
    frameId: frame.id,
    frameSize: frame.size,
    handles,
    padding: autoLayout.padding,
    transform,
  };
  return { ...plan, fingerprint: JSON.stringify(plan) };
}

function paddingHandles(
  frameId: string,
  size: { height: number; width: number },
  padding: { bottom: number; left: number; right: number; top: number },
): AutoLayoutSpacingHandleSpec[] {
  return [
    {
      axis: "y",
      id: `${frameId}:padding-top`,
      kind: "padding-top",
      orientation: "horizontal",
      value: padding.top,
      x: size.width / 2,
      y: bounded(padding.top / 2, 0, size.height),
    },
    {
      axis: "x",
      id: `${frameId}:padding-right`,
      kind: "padding-right",
      orientation: "vertical",
      value: padding.right,
      x: bounded(size.width - padding.right / 2, 0, size.width),
      y: size.height / 2,
    },
    {
      axis: "y",
      id: `${frameId}:padding-bottom`,
      kind: "padding-bottom",
      orientation: "horizontal",
      value: padding.bottom,
      x: size.width / 2,
      y: bounded(size.height - padding.bottom / 2, 0, size.height),
    },
    {
      axis: "x",
      id: `${frameId}:padding-left`,
      kind: "padding-left",
      orientation: "vertical",
      value: padding.left,
      x: bounded(padding.left / 2, 0, size.width),
      y: size.height / 2,
    },
  ];
}

function flowChildren(
  document: DesignDocument,
  childIds: readonly string[],
): FlowChild[] | null {
  const children: FlowChild[] = [];
  for (const childId of childIds) {
    const child: DesignNode | undefined = document.nodesById[childId];
    if (!child || !child.visible || child.layoutPositioning === "absolute")
      continue;
    if (!hasTranslationOnlyTransform(child.transform)) return null;
    children.push({
      height: child.size.height,
      id: child.id,
      width: child.size.width,
      x: child.transform[4],
      y: child.transform[5],
    });
  }
  return children;
}

function horizontalGapHandles(
  frameId: string,
  children: readonly FlowChild[],
  value: number,
  scope: string,
): AutoLayoutSpacingHandleSpec[] {
  return children.slice(1).map((child, index) => {
    const previous = children[index]!;
    const previousEnd = previous.x + previous.width;
    const overlapStart = Math.max(previous.y, child.y);
    const overlapEnd = Math.min(
      previous.y + previous.height,
      child.y + child.height,
    );
    return {
      axis: "x",
      id: `${frameId}:gap:${scope}:${index}`,
      kind: "gap",
      orientation: "vertical",
      value,
      x: (previousEnd + child.x) / 2,
      y:
        overlapEnd >= overlapStart
          ? (overlapStart + overlapEnd) / 2
          : (previous.y + previous.height / 2 + child.y + child.height / 2) / 2,
    };
  });
}

function verticalGapHandles(
  frameId: string,
  children: readonly FlowChild[],
  value: number,
): AutoLayoutSpacingHandleSpec[] {
  return children.slice(1).map((child, index) => {
    const previous = children[index]!;
    const previousEnd = previous.y + previous.height;
    const overlapStart = Math.max(previous.x, child.x);
    const overlapEnd = Math.min(
      previous.x + previous.width,
      child.x + child.width,
    );
    return {
      axis: "y",
      id: `${frameId}:gap:flow:${index}`,
      kind: "gap",
      orientation: "horizontal",
      value,
      x:
        overlapEnd >= overlapStart
          ? (overlapStart + overlapEnd) / 2
          : (previous.x + previous.width / 2 + child.x + child.width / 2) / 2,
      y: (previousEnd + child.y) / 2,
    };
  });
}

function horizontalRows(children: readonly FlowChild[]): FlowRow[] {
  const rows: FlowRow[] = [];
  let previous: FlowChild | undefined;
  for (const child of children) {
    let row = rows.at(-1);
    if (
      !row ||
      (previous && child.x < previous.x + previous.width - ROW_EPSILON)
    ) {
      row = {
        bottom: child.y + child.height,
        children: [],
        top: child.y,
      };
      rows.push(row);
    }
    row.children.push(child);
    row.top = Math.min(row.top, child.y);
    row.bottom = Math.max(row.bottom, child.y + child.height);
    previous = child;
  }
  return rows;
}

function counterGapHandles(
  frameId: string,
  frameWidth: number,
  rows: readonly FlowRow[],
  value: number,
): AutoLayoutSpacingHandleSpec[] {
  return rows.slice(1).map((row, index) => {
    const previous = rows[index]!;
    return {
      axis: "y",
      id: `${frameId}:counter-gap:${index}`,
      kind: "counter-gap",
      orientation: "horizontal",
      value,
      x: frameWidth / 2,
      y: (previous.bottom + row.top) / 2,
    };
  });
}

function bounded(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
