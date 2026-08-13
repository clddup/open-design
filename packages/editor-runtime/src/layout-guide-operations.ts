import type {
  DesignDocument,
  DesignOperation,
  LayoutGuide,
} from "@opendesign/design-contracts";

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
  if (
    guides.some(
      (guide) =>
        typeof guide.id !== "string" ||
        guide.id.length === 0 ||
        guide.id.length > 256 ||
        guide.type !== "grid" ||
        !Number.isFinite(guide.size) ||
        guide.size < 1 ||
        guide.size > 10_000 ||
        typeof guide.color !== "string" ||
        guide.color.length === 0 ||
        guide.color.length > 128 ||
        !Number.isFinite(guide.opacity) ||
        guide.opacity < 0 ||
        guide.opacity > 1,
    )
  ) {
    return failure("invalid-target", "Layout guide values are invalid");
  }
  if (
    guides.some(
      (guide) =>
        Math.max(0, Math.ceil(frame.size.width / guide.size) - 1) +
          Math.max(0, Math.ceil(frame.size.height / guide.size) - 1) >
        4_096,
    )
  ) {
    return failure(
      "invalid-target",
      "Layout guide density exceeds the 4096-line safety limit for this Frame",
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
