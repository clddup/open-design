import type {
  DesignDocument,
  DesignOperation,
  LayoutGuide,
} from "@opendesign/design-contracts";
import { layoutGuideGeometryIsValid } from "@opendesign/design-contracts";

export type LayoutGuideOperationPlan =
  | {
      ok: true;
      commands: DesignOperation[];
      frameId: string;
      nodeIds: string[];
    }
  | {
      ok: false;
      code: "invalid-target" | "locked" | "no-op" | "not-found";
      message: string;
    };

export function planSetFrameLayoutGuides(
  document: DesignDocument,
  pageId: string,
  frameId: string,
  layoutGuides: readonly LayoutGuide[],
  commandPrefix: string,
): LayoutGuideOperationPlan {
  const frame = document.nodesById[frameId];
  if (!frame) return failure("not-found", `Frame ${frameId} does not exist`);
  if (frame.kind !== "frame" || !belongsToPage(document, pageId, frameId)) {
    return failure(
      "invalid-target",
      `Target ${frameId} must be a Frame on Page ${pageId}`,
    );
  }
  if (isLocked(document, frameId)) {
    return failure("locked", "Locked Frames cannot change layout guides");
  }
  const guides = [...layoutGuides];
  if (guides.length > 8) {
    return failure(
      "invalid-target",
      "A Frame can contain at most 8 layout guides",
    );
  }
  if (guides.some((guide) => !layoutGuideValueIsValid(guide))) {
    return failure("invalid-target", "Layout guide values are invalid");
  }
  if (guides.some((guide) => !layoutGuideGeometryIsValid(frame.size, guide))) {
    return failure(
      "invalid-target",
      "Layout guide geometry exceeds the Frame or 4096-primitive safety limit",
    );
  }
  const ids = new Set<string>();
  for (const guide of guides) {
    if (ids.has(guide.id)) {
      return failure("invalid-target", "Layout guide IDs must be unique");
    }
    ids.add(guide.id);
  }
  if (
    JSON.stringify(frame.properties.layoutGuides ?? []) ===
    JSON.stringify(guides)
  ) {
    return failure("no-op", "Frame already uses the requested layout guides");
  }
  return {
    ok: true,
    frameId,
    nodeIds: [frameId],
    commands: [
      {
        commandId: `${commandPrefix}_guides`,
        type: "update_properties",
        nodeId: frameId,
        properties: { layoutGuides: guides },
      },
    ],
  };
}

function layoutGuideValueIsValid(guide: LayoutGuide): boolean {
  const appearanceIsValid =
    typeof guide.id === "string" &&
    guide.id.length > 0 &&
    guide.id.length <= 256 &&
    typeof guide.color === "string" &&
    guide.color.length > 0 &&
    guide.color.length <= 128 &&
    Number.isFinite(guide.opacity) &&
    guide.opacity >= 0 &&
    guide.opacity <= 1;
  if (!appearanceIsValid) return false;
  if (guide.type === "grid") {
    return (
      Number.isFinite(guide.size) && guide.size >= 1 && guide.size <= 10_000
    );
  }
  if (
    !Number.isInteger(guide.count) ||
    guide.count < 1 ||
    guide.count > 4_096 ||
    !finiteNonNegative(guide.gutter)
  ) {
    return false;
  }
  if (guide.alignment === "stretch") return finiteNonNegative(guide.margin);
  if (!Number.isFinite(guide.sectionSize) || guide.sectionSize <= 0)
    return false;
  return guide.alignment === "center" || finiteNonNegative(guide.offset);
}

function finiteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1_000_000;
}

function belongsToPage(
  document: DesignDocument,
  pageId: string,
  nodeId: string,
): boolean {
  const roots = new Set(document.pagesById[pageId]?.rootNodeIds ?? []);
  let current = document.nodesById[nodeId];
  const visited = new Set<string>();
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    if (current.parentId === null) return roots.has(current.id);
    current = document.nodesById[current.parentId];
  }
  return false;
}

function isLocked(document: DesignDocument, nodeId: string): boolean {
  let current = document.nodesById[nodeId];
  const visited = new Set<string>();
  while (current && !visited.has(current.id)) {
    if (current.locked) return true;
    visited.add(current.id);
    if (current.parentId === null) return false;
    const parent = document.nodesById[current.parentId];
    if (!parent) return false;
    current = parent;
  }
  return false;
}

function failure(
  code: Extract<LayoutGuideOperationPlan, { ok: false }>["code"],
  message: string,
): Extract<LayoutGuideOperationPlan, { ok: false }> {
  return { ok: false, code, message };
}
