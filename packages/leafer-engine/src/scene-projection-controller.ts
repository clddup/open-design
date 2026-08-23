import type { DesignDocument } from "@opendesign/design-contracts";
import {
  BOOLEAN_GEOMETRY_RESOLVER_VERSION,
  createBooleanGeometryResolver,
  type BooleanGeometryResolution,
  type BooleanGeometryResolver,
} from "@opendesign/geometry-service/boolean-resolver";
import type { VectorGeometryProvider } from "@opendesign/geometry-service/vector-path";
import {
  projectBooleanEditScope,
  projectDesignPage,
  projectDesignPageIncrementally,
  projectResolvedBooleanGeometry,
  type LeaferSceneProjection,
} from "./mapping.js";
import type { DirectTransformElementState } from "./direct-transform-controller.js";
import { projectTextRunProjection } from "./text-run-projection.js";
import type { LeaferEngineSyncInput } from "./types.js";

interface SceneProjectionControllerOptions {
  current(): {
    disposed: boolean;
    input: LeaferEngineSyncInput | null;
    sceneProjection: LeaferSceneProjection | null;
  };
  loadVectorGeometryProvider?: () => Promise<VectorGeometryProvider>;
  onAsyncProjection(
    projection: LeaferSceneProjection,
    input: LeaferEngineSyncInput,
  ): void;
  report(error: unknown): void;
}

export interface SceneProjectionOptions {
  affectedEditScopeBooleanIds?: ReadonlySet<string>;
  forceBooleanIds?: ReadonlySet<string>;
  forceEditScopeAffected?: boolean;
}

/**
 * Owns base Page mapping plus every derived Boolean/Text/Edit-scope scene
 * projection and the asynchronous vector-geometry provider lifecycle. It
 * returns immutable disposable projections; SceneReconciler remains the only
 * owner of live Leafer elements.
 */
export class SceneProjectionController {
  readonly #loadVectorGeometryProvider: () => Promise<VectorGeometryProvider>;
  readonly #options: SceneProjectionControllerOptions;
  #baseProjection: LeaferSceneProjection | null = null;
  #baseIdentity: {
    documentId: string;
    pageId: string;
    revision: number;
  } | null = null;
  #booleanNodeIds = new Set<string>();
  #booleanResolver: BooleanGeometryResolver | null = null;
  #geometryLoadError: Error | null = null;
  #geometryLoadGeneration = 0;
  #geometryLoadPromise: Promise<void> | null = null;
  readonly #disposedPromise: Promise<void>;
  #resolveDisposed: (() => void) | null = null;
  #refreshError: Error | null = null;

  constructor(options: SceneProjectionControllerOptions) {
    this.#options = options;
    this.#loadVectorGeometryProvider =
      options.loadVectorGeometryProvider ?? loadBrowserVectorGeometryProvider;
    this.#disposedPromise = new Promise((resolve) => {
      this.#resolveDisposed = resolve;
    });
  }

  get baseProjection(): LeaferSceneProjection | null {
    return this.#baseProjection;
  }

  get canPreviewBoolean(): boolean {
    return this.#baseProjection !== null && this.#booleanResolver !== null;
  }

  baseFor(
    previous: LeaferEngineSyncInput | null,
    input: LeaferEngineSyncInput,
    documentSceneChanged: boolean,
    options: { forceFull?: boolean } = {},
  ): LeaferSceneProjection {
    return options.forceFull === true
      ? projectDesignPage(input.document, input.pageId)
      : documentSceneChanged
        ? previous && this.#baseProjection && input.changes
          ? projectDesignPageIncrementally(
              this.#baseProjection,
              input.document,
              input.pageId,
              input.changes,
            )
          : projectDesignPage(input.document, input.pageId)
        : (this.#baseProjection ??
          projectDesignPage(input.document, input.pageId));
  }

  commitApplied(
    input: LeaferEngineSyncInput,
    base?: LeaferSceneProjection,
  ): void {
    if (base) {
      this.#baseProjection = base;
      this.#baseIdentity = inputIdentity(input);
      this.#booleanNodeIds = collectBooleanNodeIds(base);
    }
    this.#refreshError = null;
  }

  project(
    input: LeaferEngineSyncInput,
    base: LeaferSceneProjection,
    options: SceneProjectionOptions = {},
  ): LeaferSceneProjection {
    const projection = this.#projectBooleanGeometry(
      input,
      base,
      options.forceBooleanIds,
    );
    return projectTextRunProjection(
      projectBooleanEditScope(
        projection,
        input.document,
        input.booleanEditScope,
        options.affectedEditScopeBooleanIds
          ? {
              affectedBooleanNodeIds: options.affectedEditScopeBooleanIds,
              forceAffected: options.forceEditScopeAffected === true,
            }
          : {},
      ),
      input.textRunProjection,
      this.#options.current().sceneProjection,
    );
  }

  rebuild(input: LeaferEngineSyncInput): LeaferSceneProjection {
    return projectDesignPage(input.document, input.pageId);
  }

  previewBooleanTransform(
    input: LeaferEngineSyncInput,
    states: ReadonlyMap<string, DirectTransformElementState>,
  ): LeaferSceneProjection | null {
    const base = this.#baseProjection;
    const resolver = this.#booleanResolver;
    if (
      !input.booleanEditScope ||
      input.booleanEditScope.readOnly ||
      !base ||
      !resolver
    ) {
      return null;
    }
    const nodesById: DesignDocument["nodesById"] = {
      ...input.document.nodesById,
    };
    for (const [nodeId, current] of states) {
      const node = input.document.nodesById[nodeId];
      if (!node) continue;
      nodesById[nodeId] = {
        ...node,
        transform: current.transform,
        ...(node.kind === "group" ||
        node.kind === "boolean" ||
        node.kind === "instance"
          ? {}
          : { size: current.size }),
      };
    }
    const previewDocument: DesignDocument = {
      ...input.document,
      nodesById,
    };
    try {
      const resolution = resolver.resolve(previewDocument, input.pageId);
      return projectBooleanEditScope(
        projectResolvedBooleanGeometry(base, previewDocument, resolution, {
          affectedBooleanNodeIds: new Set([
            ...resolution.computedNodeIds,
            input.booleanEditScope.booleanId,
          ]),
        }),
        previewDocument,
        input.booleanEditScope,
      );
    } catch (error) {
      this.#options.report(error);
      return null;
    }
  }

  retry(): boolean {
    const current = this.#options.current();
    if (
      !current.disposed &&
      this.#refreshError &&
      this.#booleanResolver &&
      this.#booleanNodeIds.size > 0
    ) {
      this.#refreshError = null;
      this.#refresh();
      return true;
    }
    if (
      current.disposed ||
      !this.#geometryLoadError ||
      this.#booleanNodeIds.size === 0
    ) {
      return false;
    }
    this.#geometryLoadError = null;
    this.#geometryLoadPromise = null;
    this.#refresh();
    return true;
  }

  async settlePendingGeometry(): Promise<void> {
    const pending = this.#geometryLoadPromise;
    if (pending) await Promise.race([pending, this.#disposedPromise]);
    if (this.#refreshError) throw this.#refreshError;
  }

  dispose(): void {
    this.#geometryLoadGeneration += 1;
    this.#resolveDisposed?.();
    this.#resolveDisposed = null;
    this.#geometryLoadPromise = null;
    this.#booleanResolver?.clear();
    this.#booleanResolver = null;
    this.#baseProjection = null;
    this.#baseIdentity = null;
    this.#booleanNodeIds.clear();
    this.#geometryLoadError = null;
    this.#refreshError = null;
  }

  #projectBooleanGeometry(
    input: LeaferEngineSyncInput,
    base: LeaferSceneProjection,
    forceBooleanIds?: ReadonlySet<string>,
  ): LeaferSceneProjection {
    const currentBooleanIds = collectBooleanNodeIds(base);
    const removedBooleanIds = new Set(
      [...this.#booleanNodeIds].filter(
        (nodeId) => !currentBooleanIds.has(nodeId),
      ),
    );
    if (currentBooleanIds.size === 0) {
      return removedBooleanIds.size === 0
        ? base
        : projectResolvedBooleanGeometry(
            base,
            input.document,
            emptyBooleanResolution(base.pageId),
            { removedBooleanNodeIds: removedBooleanIds },
          );
    }

    if (!this.#booleanResolver) {
      if (this.#geometryLoadError) {
        const incremental =
          base.affectedNodeIds !== undefined || forceBooleanIds !== undefined;
        return projectResolvedBooleanGeometry(
          base,
          input.document,
          failedBooleanResolution(
            base.pageId,
            currentBooleanIds,
            this.#geometryLoadError,
          ),
          incremental
            ? {
                affectedBooleanNodeIds:
                  forceBooleanIds ?? new Set(currentBooleanIds),
                removedBooleanNodeIds: removedBooleanIds,
              }
            : {},
        );
      }
      this.#ensureVectorGeometryProvider();
      return base;
    }

    const resolution = this.#booleanResolver.resolve(
      input.document,
      base.pageId,
    );
    const incremental =
      base.affectedNodeIds !== undefined || forceBooleanIds !== undefined;
    return projectResolvedBooleanGeometry(
      base,
      input.document,
      resolution,
      incremental
        ? {
            affectedBooleanNodeIds: new Set([
              ...resolution.computedNodeIds,
              ...(forceBooleanIds ?? []),
            ]),
            removedBooleanNodeIds: removedBooleanIds,
          }
        : {},
    );
  }

  #ensureVectorGeometryProvider(): void {
    const current = this.#options.current();
    if (
      current.disposed ||
      this.#geometryLoadPromise ||
      this.#booleanResolver ||
      this.#geometryLoadError
    ) {
      return;
    }
    const generation = ++this.#geometryLoadGeneration;
    this.#geometryLoadPromise = this.#loadVectorGeometryProvider().then(
      (provider) => {
        if (
          this.#options.current().disposed ||
          generation !== this.#geometryLoadGeneration
        ) {
          return;
        }
        this.#booleanResolver = createBooleanGeometryResolver(provider);
        this.#geometryLoadError = null;
        this.#geometryLoadPromise = null;
        this.#refresh();
      },
      (error: unknown) => {
        if (
          this.#options.current().disposed ||
          generation !== this.#geometryLoadGeneration
        ) {
          return;
        }
        this.#geometryLoadError =
          error instanceof Error
            ? error
            : new Error("PathKit geometry provider failed to load");
        this.#geometryLoadPromise = null;
        this.#refresh();
      },
    );
  }

  #refresh(): void {
    const current = this.#options.current();
    const input = current.input;
    const base = this.#baseProjection;
    if (
      !base ||
      !input ||
      current.disposed ||
      !sameInputIdentity(this.#baseIdentity, input)
    ) {
      return;
    }
    try {
      this.#options.onAsyncProjection(
        this.project(input, base, {
          forceBooleanIds: new Set(this.#booleanNodeIds),
        }),
        input,
      );
      this.#refreshError = null;
    } catch (error) {
      this.#refreshError =
        error instanceof Error
          ? error
          : new Error("Asynchronous scene projection failed");
      this.#options.report(error);
    }
  }
}

function inputIdentity(input: LeaferEngineSyncInput): {
  documentId: string;
  pageId: string;
  revision: number;
} {
  return {
    documentId: input.document.documentId,
    pageId: input.pageId,
    revision: input.document.revision,
  };
}

function sameInputIdentity(
  identity: ReturnType<typeof inputIdentity> | null,
  input: LeaferEngineSyncInput,
): boolean {
  return (
    identity?.documentId === input.document.documentId &&
    identity.pageId === input.pageId &&
    identity.revision === input.document.revision
  );
}

async function loadBrowserVectorGeometryProvider(): Promise<VectorGeometryProvider> {
  const module =
    await import("@opendesign/geometry-service/browser-vector-path");
  return module.loadBrowserVectorGeometryProvider();
}

function collectBooleanNodeIds(projection: LeaferSceneProjection): Set<string> {
  return new Set(
    [...projection.elementsById.values()]
      .filter((spec) => spec.kind === "boolean")
      .map((spec) => spec.id),
  );
}

function failedBooleanResolution(
  pageId: string,
  nodeIds: ReadonlySet<string>,
  error: Error,
): BooleanGeometryResolution {
  return {
    computedNodeIds: [],
    issues: [...nodeIds].map((nodeId) => ({
      code: "provider-failure" as const,
      message: `Boolean geometry provider failed to load: ${error.message}`,
      nodeId,
    })),
    pageId,
    resolverVersion: BOOLEAN_GEOMETRY_RESOLVER_VERSION,
    resultsByNodeId: new Map(),
    reusedNodeIds: [],
  };
}

function emptyBooleanResolution(pageId: string): BooleanGeometryResolution {
  return {
    computedNodeIds: [],
    issues: [],
    pageId,
    resolverVersion: BOOLEAN_GEOMETRY_RESOLVER_VERSION,
    resultsByNodeId: new Map(),
    reusedNodeIds: [],
  };
}
