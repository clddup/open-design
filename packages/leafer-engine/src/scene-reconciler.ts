import type { Transform } from "@opendesign/design-contracts";
import type * as LeaferEditorModule from "leafer-editor";
import {
  type LeaferElementSpec,
  type LeaferElementTag,
  type LeaferSceneProjection,
} from "./mapping.js";
import { transformToAffine } from "./affine.js";
import { materializeLeaferTextData } from "./text-truncation.js";

type LeaferModule = typeof LeaferEditorModule;
type LeaferElement = InstanceType<LeaferModule["UI"]>;
type LeaferGroup = InstanceType<LeaferModule["Group"]>;
type LeaferEditor = InstanceType<LeaferModule["Editor"]>;

interface SceneReconcilerOptions {
  editor: Pick<LeaferEditor, "hasItem" | "removeItem">;
  leafer: LeaferModule;
  onWarning(warning: LeaferSceneProjection["warnings"][number]): void;
  onWarningsChange(warnings: LeaferSceneProjection["warnings"]): void;
  report(error: unknown): void;
  root: LeaferGroup;
  scheduleEditorRefresh(request: {
    nodeBounds?: ReadonlySet<string>;
    treeBounds?: boolean;
  }): void;
  selectionNodeIds(): readonly string[];
}

/**
 * Owns the disposable Leafer scene projection and its element identity map.
 * It only reconciles an already-derived exact-revision projection; document
 * data, history and design mutations remain outside this owner.
 */
export class SceneReconciler {
  readonly #elements = new Map<string, LeaferElement>();
  readonly #options: SceneReconcilerOptions;
  #projection: LeaferSceneProjection | null = null;

  constructor(options: SceneReconcilerOptions) {
    this.#options = options;
  }

  get projection(): LeaferSceneProjection | null {
    return this.#projection;
  }

  applySpecData(
    element: LeaferElement,
    spec: LeaferElementSpec,
    overrides: Record<string, unknown> = {},
  ): void {
    const data =
      spec.tag === "Text"
        ? materializeLeaferTextData(
            this.#options.leafer,
            spec.data,
            spec.textMaxLines,
          )
        : spec.data;
    element.set({ ...data, ...overrides });
  }

  dispose(): void {
    this.#elements.clear();
    this.#projection = null;
  }

  createElement(tag: LeaferElementTag): LeaferElement {
    const Constructor = this.#options.leafer[tag] as new (
      data?: Record<string, unknown>,
    ) => LeaferElement;
    return new Constructor();
  }

  element(projectionId: string): LeaferElement | undefined {
    return this.#elements.get(projectionId);
  }

  has(projectionId: string): boolean {
    return this.#elements.has(projectionId);
  }

  projectionId(element: LeaferElement): string | undefined {
    const id = element.id;
    return typeof id === "string" && this.#elements.get(id) === element
      ? id
      : undefined;
  }

  reconcile(
    projection: LeaferSceneProjection,
    options: { reapplyAll?: boolean } = {},
  ): void {
    const previous = this.#projection;
    const changedNodeIds = new Set<string>();
    const parentsToAttach = new Set<string | null>();
    const reapplyAll = options.reapplyAll === true;
    for (const warning of projection.warnings) {
      this.#publishObserver(() => this.#options.onWarning(warning));
    }
    this.#publishObserver(() =>
      this.#options.onWarningsChange(projection.warnings),
    );

    const candidateNodeIds =
      projection.affectedNodeIds ?? this.#elements.keys();
    for (const nodeId of candidateNodeIds) {
      const element = this.#elements.get(nodeId);
      if (!element || projection.elementsById.has(nodeId)) continue;
      changedNodeIds.add(nodeId);
      parentsToAttach.add(previous?.elementsById.get(nodeId)?.parentId ?? null);
      if (this.#options.editor.hasItem(element)) {
        this.#options.editor.removeItem(element);
      }
      element.remove();
      element.destroy();
      this.#elements.delete(nodeId);
    }

    const candidateSpecs: LeaferElementSpec[] = [];
    if (projection.affectedNodeIds) {
      projection.affectedNodeIds.forEach((nodeId) => {
        const spec = projection.elementsById.get(nodeId);
        if (spec) candidateSpecs.push(spec);
      });
    } else {
      candidateSpecs.push(...projection.elementsById.values());
    }
    for (const spec of candidateSpecs) {
      const previousSpec = previous?.elementsById.get(spec.id);
      let existing = this.#elements.get(spec.id);
      let replaced = false;
      if (existing && elementTag(existing) !== spec.tag) {
        if (this.#options.editor.hasItem(existing)) {
          this.#options.editor.removeItem(existing);
        }
        existing.remove();
        existing.destroy();
        this.#elements.delete(spec.id);
        existing = undefined;
        replaced = true;
      }
      const created = existing === undefined;
      const element = existing ?? this.createElement(spec.tag);
      this.#elements.set(spec.id, element);
      const dataChanged =
        reapplyAll ||
        created ||
        previousSpec?.textMaxLines !== spec.textMaxLines ||
        !sameProjectionValue(previousSpec?.data, spec.data);
      const transformChanged =
        reapplyAll ||
        created ||
        !previousSpec ||
        !sameTransform(previousSpec.transform, spec.transform);
      const parentChanged =
        !previousSpec || previousSpec.parentId !== spec.parentId;
      const childrenChanged =
        !previousSpec || !sameStringList(previousSpec.childIds, spec.childIds);
      if (dataChanged) this.applySpecData(element, spec);
      if (transformChanged) {
        element.setTransform(transformToAffine(spec.transform));
      }
      if (dataChanged || transformChanged || parentChanged || replaced) {
        changedNodeIds.add(spec.id);
      }
      if (parentChanged || created || replaced) {
        parentsToAttach.add(previousSpec?.parentId ?? null);
        parentsToAttach.add(spec.parentId);
      }
      if (childrenChanged || created || replaced || reapplyAll) {
        parentsToAttach.add(spec.id);
      }
    }

    const attachChildren = (
      parent: LeaferGroup,
      childIds: readonly string[],
    ) => {
      childIds.forEach((childId, index) => {
        const child = this.#elements.get(childId);
        if (!child) return;
        if (child.parent !== parent || parent.children[index] !== child) {
          parent.addAt(child, index);
        }
      });
    };
    if (
      reapplyAll ||
      !previous ||
      !sameStringList(previous.rootIds, projection.rootIds)
    ) {
      parentsToAttach.add(null);
    }
    for (const parentId of parentsToAttach) {
      if (parentId === null) {
        attachChildren(this.#options.root, projection.rootIds);
        continue;
      }
      const spec = projection.elementsById.get(parentId);
      const element = this.#elements.get(parentId);
      if (spec && element && "children" in element) {
        attachChildren(element as LeaferGroup, spec.childIds);
      }
    }
    this.#projection = projection;
    if (reapplyAll || !previous) {
      this.#options.scheduleEditorRefresh({ treeBounds: true });
      return;
    }
    const selectionBounds = this.selectionBoundsAffected(
      changedNodeIds,
      previous,
      projection,
    );
    if (selectionBounds.size > 0) {
      this.#options.scheduleEditorRefresh({ nodeBounds: selectionBounds });
    }
  }

  selectionBoundsAffected(
    changedNodeIds: ReadonlySet<string>,
    previous: LeaferSceneProjection,
    projection: LeaferSceneProjection,
  ): Set<string> {
    const selection = this.#options.selectionNodeIds();
    if (changedNodeIds.size === 0 || selection.length === 0) return new Set();
    const affectedSelection = new Set<string>();
    const selectedNodeIds = new Set(selection);
    for (const selectedNodeId of selectedNodeIds) {
      if (
        lineage(selectedNodeId, previous).some((nodeId) =>
          changedNodeIds.has(nodeId),
        ) ||
        lineage(selectedNodeId, projection).some((nodeId) =>
          changedNodeIds.has(nodeId),
        )
      ) {
        affectedSelection.add(selectedNodeId);
      }
    }
    for (const changedNodeId of changedNodeIds) {
      for (const nodeId of [
        ...lineage(changedNodeId, previous),
        ...lineage(changedNodeId, projection),
      ]) {
        if (selectedNodeIds.has(nodeId)) affectedSelection.add(nodeId);
      }
    }
    return affectedSelection;
  }

  #publishObserver(publish: () => void): void {
    try {
      publish();
    } catch (error) {
      try {
        this.#options.report(error);
      } catch {
        // Observer failures must never participate in scene reconciliation.
      }
    }
  }
}

function elementTag(element: LeaferElement): string {
  return (element as LeaferElement & { tag?: string }).tag ?? "";
}

function sameProjectionValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameProjectionValue(value, right[index]))
    );
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.hasOwn(right, key) && sameProjectionValue(left[key], right[key]),
    )
  );
}

function sameTransform(left: Transform, right: Transform): boolean {
  return left.every(
    (value, index) => Math.abs(value - (right[index] ?? 0)) <= 0.000_001,
  );
}

function sameStringList(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function lineage(nodeId: string, projection: LeaferSceneProjection): string[] {
  const result: string[] = [];
  let current: string | null = nodeId;
  const visited = new Set<string>();
  while (current && !visited.has(current)) {
    visited.add(current);
    result.push(current);
    current = projection.elementsById.get(current)?.parentId ?? null;
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
