import { isDeepStrictEqual } from "node:util";
import type { DesignChangeSet } from "@opendesign/design-contracts";
import type {
  DesignDeliveryTargetState,
  InspectedHierarchy,
} from "./design-plan-registration.js";

export type CommittedDesignEditTarget = {
  artboardDescendantIds: ReadonlySet<string>;
  planned: {
    artboard: Pick<DesignDeliveryTargetState["planned"]["artboard"], "frameId">;
  };
};

export type CommittedDesignEditImpact = {
  /** Dirty evidence only; shared/ancestor changes are not Plan step progress. */
  affected: boolean;
  /** Unequal committed node snapshots directly touching physical members/root. */
  materialChanged: boolean;
  addedNodeIds: ReadonlySet<string>;
  removedNodeIds: ReadonlySet<string>;
  /** Physical descendants excluding the target root, never component references. */
  afterDescendantIds: ReadonlySet<string>;
};

type NodeView = { parentId: string | null; componentId: string | null };
type ParentView = {
  nodes: ReadonlyMap<string, NodeView>;
  absent: ReadonlySet<string>;
};
type NodeChange = DesignChangeSet["changes"][number];
type SnapshotChange = { before?: unknown; after?: unknown };

/**
 * Main supplies an identity-checked committed ChangeSet and the corresponding
 * inspection (before or after). Views are disposable projections, not document
 * state. Incomplete chains preserve known old members, but never infer new ones.
 */
export function computeCommittedDesignEditImpact(
  changes: DesignChangeSet,
  inspection: InspectedHierarchy | undefined,
  targets: ReadonlyMap<string, CommittedDesignEditTarget>,
): ReadonlyMap<string, CommittedDesignEditImpact> {
  const before = parentView(changes, inspection, "before");
  const after = parentView(changes, inspection, "after");
  const material = changes.changes.filter(nodeChanged);
  const sharedComponents = changedComponents(
    changes,
    inspection,
    before,
    after,
  );
  const sharedDirty = hasSharedResourceChanges(changes);
  const result = new Map<string, CommittedDesignEditImpact>();
  for (const [targetId, target] of targets) {
    const root = target.planned.artboard.frameId;
    const oldMembers = members(before, root, target.artboardDescendantIds);
    const newMembers = members(after, root, oldMembers);
    const addedNodeIds = difference(newMembers, oldMembers);
    const removedNodeIds = difference(oldMembers, newMembers);
    addedNodeIds.delete(root);
    removedNodeIds.delete(root);
    result.set(targetId, {
      affected:
        addedNodeIds.size > 0 ||
        removedNodeIds.size > 0 ||
        material.some((change) =>
          touchesTarget(change, root, before, after, oldMembers, newMembers),
        ) ||
        sharedDirty ||
        referencesComponent(before, oldMembers, sharedComponents) ||
        referencesComponent(after, newMembers, sharedComponents),
      materialChanged: material.some(
        (change) =>
          snapshotsChanged(change) &&
          (oldMembers.has(change.nodeId) || newMembers.has(change.nodeId)),
      ),
      addedNodeIds,
      removedNodeIds,
      afterDescendantIds: difference(newMembers, new Set([root])),
    });
  }
  return result;
}

function parentView(
  changes: DesignChangeSet,
  inspection: InspectedHierarchy | undefined,
  side: "before" | "after",
): ParentView {
  const nodes = new Map<string, NodeView>();
  const absent = new Set<string>();
  for (const [id, node] of inspection?.nodesById ?? []) {
    nodes.set(id, { parentId: node.parentId, componentId: node.componentId });
  }
  for (const change of changes.changes) {
    const node = change[side];
    if (node) {
      nodes.set(change.nodeId, {
        parentId: node.parentId,
        componentId:
          node.kind === "instance" ? node.properties.componentId : null,
      });
    } else {
      nodes.delete(change.nodeId);
      absent.add(change.nodeId);
    }
  }
  return { nodes, absent };
}

/** undefined means missing ancestry or a cycle, not proof of membership. */
function belongsTo(
  view: ParentView,
  nodeId: string,
  root: string,
): boolean | undefined {
  if (view.absent.has(root)) return false;
  const visited = new Set<string>();
  let current: string | null = nodeId;
  while (current !== null) {
    if (view.absent.has(current)) return false;
    if (visited.has(current)) return undefined;
    visited.add(current);
    if (current === root) return true;
    const node = view.nodes.get(current);
    if (!node) return undefined;
    current = node.parentId;
  }
  return false;
}

function members(
  view: ParentView,
  root: string,
  known: ReadonlySet<string>,
): Set<string> {
  const result = new Set<string>();
  for (const id of new Set([...view.nodes.keys(), ...known])) {
    const belongs = belongsTo(view, id, root);
    if (belongs === true || (belongs === undefined && known.has(id))) {
      result.add(id);
    }
  }
  return result;
}

function difference(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  return new Set([...left].filter((id) => !right.has(id)));
}

function snapshotsChanged(change: SnapshotChange): boolean {
  return !isDeepStrictEqual(change.before, change.after);
}

function nodeChanged(change: NodeChange): boolean {
  // Runtime records sibling/page-root order outside the node snapshot itself.
  return (
    snapshotsChanged(change) ||
    (change.type === "moved" && change.changedFields.includes("zOrder"))
  );
}

function touchesTarget(
  change: NodeChange,
  root: string,
  before: ParentView,
  after: ParentView,
  oldMembers: ReadonlySet<string>,
  newMembers: ReadonlySet<string>,
): boolean {
  if (oldMembers.has(change.nodeId) || newMembers.has(change.nodeId))
    return true;
  // A parent's childIds-only change must not dirty unrelated sibling targets;
  // actual layout propagation is already represented by changed node snapshots.
  if (!ancestorAppearanceChanged(change)) return false;
  return (
    belongsTo(before, root, change.nodeId) === true ||
    belongsTo(after, root, change.nodeId) === true
  );
}

function ancestorAppearanceChanged(change: NodeChange): boolean {
  if (!change.before || !change.after) return nodeChanged(change);
  const { childIds: beforeChildren, ...before } = change.before;
  const { childIds: afterChildren, ...after } = change.after;
  void beforeChildren;
  void afterChildren;
  return (
    !isDeepStrictEqual(before, after) ||
    (change.type === "moved" && change.changedFields.includes("zOrder"))
  );
}

function changedComponents(
  changes: DesignChangeSet,
  inspection: InspectedHierarchy | undefined,
  before: ParentView,
  after: ParentView,
): Set<string> {
  const roots = new Map<string, Set<string>>();
  const changed = new Set<string>();
  for (const component of inspection?.componentsById.values() ?? []) {
    roots.set(component.id, new Set([component.rootNodeId]));
  }
  for (const change of changes.componentChanges ?? []) {
    const ids = roots.get(change.componentId) ?? new Set<string>();
    if (change.before) ids.add(change.before.rootNodeId);
    if (change.after) ids.add(change.after.rootNodeId);
    roots.set(change.componentId, ids);
    if (snapshotsChanged(change)) changed.add(change.componentId);
  }
  for (const change of changes.libraryComponentChanges ?? []) {
    if (snapshotsChanged(change)) changed.add(change.componentId);
  }
  const material = changes.changes.filter(nodeChanged);
  for (const [id, componentRoots] of roots) {
    if (
      [...componentRoots].some((root) => {
        const oldMembers = members(before, root, new Set());
        const newMembers = members(after, root, new Set());
        return material.some((change) =>
          touchesTarget(change, root, before, after, oldMembers, newMembers),
        );
      })
    )
      changed.add(id);
  }
  expandComponentDependents(changed, roots, before, after);
  return changed;
}

function expandComponentDependents(
  changed: Set<string>,
  roots: ReadonlyMap<string, ReadonlySet<string>>,
  before: ParentView,
  after: ParentView,
): void {
  let previousSize: number;
  do {
    previousSize = changed.size;
    for (const [id, componentRoots] of roots) {
      if (changed.has(id)) continue;
      if (
        [...componentRoots].some((root) =>
          [before, after].some((view) =>
            referencesComponent(view, members(view, root, new Set()), changed),
          ),
        )
      )
        changed.add(id);
    }
  } while (changed.size !== previousSize);
}

function referencesComponent(
  view: ParentView,
  ids: ReadonlySet<string>,
  components: ReadonlySet<string>,
): boolean {
  return [...ids].some((id) => {
    const componentId = view.nodes.get(id)?.componentId;
    return componentId != null && components.has(componentId);
  });
}

function hasSharedResourceChanges(changes: DesignChangeSet): boolean {
  // Inspection omits complete style/variable/asset dependencies. Conservatively
  // invalidate review for all targets; this never creates members or progress.
  const definitions = [
    changes.styleChanges,
    changes.libraryStyleChanges,
    changes.variantSetChanges,
    changes.libraryVariantSetChanges,
    changes.variableChanges,
    changes.variableCollectionChanges,
    changes.libraryVariableChanges,
    changes.libraryVariableCollectionChanges,
  ];
  return (
    definitions.some((entries) => entries?.some(snapshotsChanged)) ||
    (changes.changedAssetIds?.length ?? 0) > 0 ||
    (changes.removedAssetIds?.length ?? 0) > 0 ||
    (changes.pageChanges ?? []).some(
      (change) =>
        !isDeepStrictEqual(
          change.before?.explicitVariableModes,
          change.after?.explicitVariableModes,
        ),
    )
  );
}
