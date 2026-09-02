import type {
  DesignDocument,
  DesignOperation,
  Guide,
} from "@opendesign/design-contracts";
import { isEffectivelyLocked } from "./layer-operations.js";

export type GuideOwner =
  | { type: "page"; pageId: string }
  | { type: "frame"; pageId: string; frameId: string };

export interface GuideEdit {
  duplicate: boolean;
  source?: { guide: Guide; index: number; owner: GuideOwner };
  target?: { guide: Guide; owner: GuideOwner };
}

export type GuideOperationPlan =
  | { ok: true; commands: DesignOperation[]; nodeIds: string[] }
  | {
      ok: false;
      code: "invalid-target" | "locked" | "no-op" | "not-found";
      message: string;
    };

export function planSetGuides(
  document: DesignDocument,
  owner: GuideOwner,
  guides: readonly Guide[],
  commandPrefix: string,
): GuideOperationPlan {
  if (owner.type === "page") {
    const page = document.pagesById[owner.pageId];
    if (!page)
      return failure("not-found", `Page ${owner.pageId} does not exist`);
    if (sameGuides(page.guides, guides)) {
      return failure("no-op", "Page already uses the requested ruler guides");
    }
    return {
      ok: true,
      nodeIds: [],
      commands: [
        {
          commandId: `${commandPrefix}_page_guides`,
          type: "update_page",
          pageId: owner.pageId,
          guides: [...guides],
        },
      ],
    };
  }

  const frame = document.nodesById[owner.frameId];
  if (!frame)
    return failure("not-found", `Frame ${owner.frameId} does not exist`);
  if (
    frame.kind !== "frame" ||
    !belongsToPage(document, owner.pageId, frame.id)
  ) {
    return failure(
      "invalid-target",
      `Target ${owner.frameId} must be a Frame on Page ${owner.pageId}`,
    );
  }
  if (isEffectivelyLocked(document, frame.id)) {
    return failure("locked", "Locked Frames cannot change ruler guides");
  }
  if (sameGuides(frame.properties.guides, guides)) {
    return failure("no-op", "Frame already uses the requested ruler guides");
  }
  return {
    ok: true,
    nodeIds: [frame.id],
    commands: [
      {
        commandId: `${commandPrefix}_frame_guides`,
        type: "update_properties",
        nodeId: frame.id,
        properties: { guides: [...guides] },
      },
    ],
  };
}

export function planEditGuide(
  document: DesignDocument,
  edit: GuideEdit,
  commandPrefix: string,
): GuideOperationPlan {
  if (!edit.source && !edit.target) {
    return failure("no-op", "The ruler guide edit does not change anything");
  }
  const sourceGuides = edit.source
    ? guidesForOwner(document, edit.source.owner)
    : null;
  if (sourceGuides && !sourceGuides.ok) return sourceGuides;
  const targetGuides = edit.target
    ? guidesForOwner(document, edit.target.owner)
    : null;
  if (targetGuides && !targetGuides.ok) return targetGuides;
  if (edit.source && sourceGuides?.ok) {
    const current = sourceGuides.guides[edit.source.index];
    if (!current || !sameGuide(current, edit.source.guide)) {
      return failure(
        "invalid-target",
        "The ruler guide changed before the edit was committed",
      );
    }
  }

  const updates = new Map<string, { owner: GuideOwner; guides: Guide[] }>();
  const mutable = (owner: GuideOwner): Guide[] => {
    const key = ownerKey(owner);
    const existing = updates.get(key);
    if (existing) return existing.guides;
    const current = guidesForOwner(document, owner);
    if (!current.ok) throw new Error(current.message);
    const guides = [...current.guides];
    updates.set(key, { owner, guides });
    return guides;
  };

  if (edit.source && !edit.duplicate) {
    mutable(edit.source.owner).splice(edit.source.index, 1);
  }
  if (edit.target) {
    const target = mutable(edit.target.owner);
    const sameOwner =
      edit.source &&
      ownerKey(edit.source.owner) === ownerKey(edit.target.owner);
    if (sameOwner && !edit.duplicate && edit.source) {
      target.splice(edit.source.index, 0, edit.target.guide);
    } else {
      target.push(edit.target.guide);
    }
  }

  const commands: DesignOperation[] = [];
  for (const [index, update] of [...updates.values()].entries()) {
    const plan = planSetGuides(
      document,
      update.owner,
      update.guides,
      `${commandPrefix}_${index}`,
    );
    if (!plan.ok) {
      if (plan.code === "no-op" && updates.size > 1) continue;
      return plan;
    }
    commands.push(...plan.commands);
  }
  return commands.length > 0
    ? {
        ok: true,
        commands,
        nodeIds: [...updates.values()].flatMap(({ owner }) =>
          owner.type === "frame" ? [owner.frameId] : [],
        ),
      }
    : failure("no-op", "The ruler guide edit does not change anything");
}

function sameGuides(
  current: readonly Guide[] | undefined,
  next: readonly Guide[],
): boolean {
  const existing = current ?? [];
  return (
    existing.length === next.length &&
    existing.every((guide, index) => {
      const candidate = next[index];
      return candidate !== undefined && sameGuide(guide, candidate);
    })
  );
}

function sameGuide(left: Guide, right: Guide): boolean {
  return left.axis === right.axis && left.offset === right.offset;
}

function guidesForOwner(
  document: DesignDocument,
  owner: GuideOwner,
):
  | { ok: true; guides: readonly Guide[] }
  | Extract<GuideOperationPlan, { ok: false }> {
  if (owner.type === "page") {
    const page = document.pagesById[owner.pageId];
    return page
      ? { ok: true, guides: page.guides ?? [] }
      : failure("not-found", `Page ${owner.pageId} does not exist`);
  }
  const frame = document.nodesById[owner.frameId];
  if (!frame)
    return failure("not-found", `Frame ${owner.frameId} does not exist`);
  if (
    frame.kind !== "frame" ||
    !belongsToPage(document, owner.pageId, frame.id)
  ) {
    return failure(
      "invalid-target",
      `Target ${owner.frameId} must be a Frame on Page ${owner.pageId}`,
    );
  }
  return { ok: true, guides: frame.properties.guides ?? [] };
}

function ownerKey(owner: GuideOwner): string {
  return owner.type === "page"
    ? `page:${owner.pageId}`
    : `frame:${owner.frameId}`;
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

function failure(
  code: Extract<GuideOperationPlan, { ok: false }>["code"],
  message: string,
): Extract<GuideOperationPlan, { ok: false }> {
  return { ok: false, code, message };
}
