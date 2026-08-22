import {
  normalizeLineEndpoints,
  type Point,
} from "@opendesign/design-contracts";
import type * as LeaferEditorModule from "leafer-editor";
import type { LeaferElementSpec, LeaferSceneProjection } from "./mapping.js";
import { asLeaferEvent, eventClientPoint } from "./pointer-event.js";
import type {
  LeaferBoxCreateTool,
  LeaferCreateRequest,
  LeaferEngineSyncInput,
} from "./types.js";

type LeaferModule = typeof LeaferEditorModule;
type LeaferElement = InstanceType<LeaferModule["UI"]>;
type LeaferGroup = InstanceType<LeaferModule["Group"]>;

interface BoxDrawSession {
  documentId: string;
  dragged: boolean;
  lineEnd?: Point;
  lineStart?: Point;
  pageId: string;
  parentId: string | null;
  preview: LeaferElement;
  revision: number;
  startClient: Point;
  startLocal: Point;
  tool: LeaferBoxCreateTool;
}

interface BoxDrawControllerOptions {
  current: () => {
    disposed: boolean;
    input: LeaferEngineSyncInput | null;
    projection: LeaferSceneProjection | null;
  };
  element: (nodeId: string) => LeaferElement | undefined;
  leafer: LeaferModule;
  nodeId: (element: LeaferElement) => string | undefined;
  onCreate: (request: LeaferCreateRequest) => boolean;
  restoreProjection: () => void;
  root: LeaferGroup;
}

interface BoxDrawProjectionSync {
  changedNodeIds: ReadonlySet<string>;
  input: LeaferEngineSyncInput;
  projection: LeaferSceneProjection;
  projectionContinuityLost: boolean;
}

const MIN_DRAW_DISTANCE = 4;
const DRAW_COLOR = "#4f7fff";

export class BoxDrawController {
  readonly #options: BoxDrawControllerOptions;
  #session: BoxDrawSession | null = null;

  constructor(options: BoxDrawControllerOptions) {
    this.#options = options;
  }

  syncInput(input: LeaferEngineSyncInput): void {
    const session = this.#session;
    if (
      session &&
      (session.documentId !== input.document.documentId ||
        session.pageId !== input.pageId ||
        session.tool !== input.tool)
    ) {
      this.cancel();
    }
  }

  syncProjection(sync: BoxDrawProjectionSync): void {
    const session = this.#session;
    if (!session) return;
    const revisionChanged = session.revision !== sync.input.document.revision;
    const contiguousRevision =
      revisionChanged &&
      sync.input.changes?.documentId === session.documentId &&
      sync.input.changes.fromRevision === session.revision &&
      sync.input.changes.toRevision === sync.input.document.revision;
    const parentSpec = session.parentId
      ? sync.projection.elementsById.get(session.parentId)
      : undefined;
    const parentInvalid =
      session.parentId !== null &&
      (sync.changedNodeIds.has(session.parentId) ||
        !isDrawContainer(parentSpec) ||
        isLockedSpec(parentSpec));
    if (
      sync.projectionContinuityLost ||
      (revisionChanged && !contiguousRevision) ||
      parentInvalid
    ) {
      this.cancel();
      return;
    }
    session.revision = sync.input.document.revision;
  }

  start(event: unknown): void {
    const current = this.#options.current();
    const input = current.input;
    if (
      current.disposed ||
      !input ||
      input.tool === "select" ||
      input.tool === "pen" ||
      this.#session
    ) {
      return;
    }
    const drag = asLeaferEvent(event);
    if (drag.isCancel || drag.right || drag.middle) return;
    const parentId = this.#resolveParent(drag.target, input.tool);
    if (parentId === undefined) return;
    const parent = this.#parent(parentId);
    if (!parent) return;
    const startLocal = drag.getInnerPoint(parent);
    const preview = this.#createPreview(input.tool);
    const lineTool = isLineTool(input.tool);
    preview.set(
      lineTool
        ? {
            x: 0,
            y: 0,
            points: [
              startLocal.x,
              startLocal.y,
              startLocal.x + 1,
              startLocal.y,
            ],
          }
        : { x: startLocal.x, y: startLocal.y, width: 1, height: 1 },
    );
    parent.add(preview);
    this.#session = {
      documentId: input.document.documentId,
      dragged: false,
      ...(lineTool
        ? { lineStart: startLocal, lineEnd: startLocal }
        : undefined),
      pageId: input.pageId,
      parentId,
      preview,
      revision: input.document.revision,
      startClient: eventClientPoint(drag),
      startLocal,
      tool: input.tool,
    };
  }

  update(event: unknown): void {
    const session = this.#session;
    if (!session || this.#options.current().disposed) return;
    const drag = asLeaferEvent(event);
    if (drag.isCancel) return;
    const parent = this.#parent(session.parentId);
    if (!parent) {
      this.cancel();
      return;
    }
    const client = eventClientPoint(drag);
    const local = drag.getInnerPoint(parent);
    session.dragged =
      Math.hypot(
        client.x - session.startClient.x,
        client.y - session.startClient.y,
      ) >= MIN_DRAW_DISTANCE;
    if (isLineTool(session.tool)) {
      const endpoints = lineEndpointsFromDrag(
        session.startLocal,
        local,
        drag.shiftKey,
        drag.altKey,
      );
      session.lineStart = endpoints.start;
      session.lineEnd = endpoints.end;
      session.preview.set({
        x: 0,
        y: 0,
        points: [
          endpoints.start.x,
          endpoints.start.y,
          endpoints.end.x,
          endpoints.end.y,
        ],
      });
      return;
    }
    session.preview.set(
      rectFromPoints(session.startLocal, local, drag.shiftKey, drag.altKey),
    );
  }

  finish(event: unknown): void {
    const session = this.#session;
    if (!session) return;
    const drag = asLeaferEvent(event);
    const rawLineStart = session.lineStart ?? session.startLocal;
    const rawLineEnd = session.dragged
      ? (session.lineEnd ?? session.startLocal)
      : { x: session.startLocal.x + 160, y: session.startLocal.y };
    const lineGeometry = isLineTool(session.tool)
      ? normalizeLineEndpoints(rawLineStart, rawLineEnd)
      : undefined;
    const rect = lineGeometry?.bounds ?? {
      x: Number(session.preview.x) || session.startLocal.x,
      y: Number(session.preview.y) || session.startLocal.y,
      width: Number(session.preview.width) || 1,
      height: Number(session.preview.height) || 1,
    };
    this.cancel();
    if (drag.isCancel || this.#options.current().disposed) return;
    const request: LeaferCreateRequest = {
      dragged: session.dragged,
      height: rect.height,
      pageId: session.pageId,
      parentId: session.parentId,
      ...(lineGeometry
        ? { start: lineGeometry.start, end: lineGeometry.end }
        : undefined),
      tool: session.tool,
      width: rect.width,
      x: rect.x,
      y: rect.y,
    };
    if (!this.#options.onCreate(request)) this.#options.restoreProjection();
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    if (!this.#session || event.code !== "Escape") return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.cancel();
    return true;
  }

  cancel(): boolean {
    const session = this.#session;
    if (!session) return false;
    this.#session = null;
    session.preview.remove();
    session.preview.destroy();
    return true;
  }

  dispose(): void {
    this.cancel();
  }

  #createPreview(tool: LeaferBoxCreateTool): LeaferElement {
    if (isLineTool(tool)) {
      return new this.#options.leafer.Arrow({
        editable: false,
        hittable: false,
        stroke: DRAW_COLOR,
        strokeWidth: 2,
        startArrow: "none",
        endArrow: tool === "arrow" ? "angle" : "none",
      });
    }
    const data = {
      editable: false,
      hittable: false,
      fill: [{ type: "solid", color: DRAW_COLOR, opacity: 0.12 }],
      stroke: DRAW_COLOR,
      strokeWidth: 1,
      ...(tool === "frame" || tool === "slice"
        ? { dashPattern: [5, 4] }
        : undefined),
    };
    return tool === "ellipse"
      ? new this.#options.leafer.Ellipse(data)
      : tool === "polygon"
        ? new this.#options.leafer.Polygon({
            ...data,
            sides: 3,
          })
        : tool === "star"
          ? new this.#options.leafer.Star({
              ...data,
              corners: 5,
              innerRadius: 0.382,
            })
          : new this.#options.leafer.Rect(data);
  }

  #parent(parentId: string | null): LeaferGroup | undefined {
    return parentId
      ? (this.#options.element(parentId) as LeaferGroup | undefined)
      : this.#options.root;
  }

  #resolveParent(
    target: unknown,
    tool: LeaferBoxCreateTool,
  ): string | null | undefined {
    if (tool === "frame") return null;
    const projection = this.#options.current().projection;
    let element = isElement(target) ? target : undefined;
    while (element) {
      const nodeId = this.#options.nodeId(element);
      const spec = nodeId ? projection?.elementsById.get(nodeId) : undefined;
      if (isLockedSpec(spec)) return undefined;
      if (isDrawContainer(spec)) return spec.id;
      element = isElement(element.parent) ? element.parent : undefined;
    }
    return null;
  }
}

function isDrawContainer(
  spec: LeaferElementSpec | undefined,
): spec is LeaferElementSpec & { kind: "frame" | "group" | "slot" } {
  return (
    spec?.kind === "frame" || spec?.kind === "slot" || spec?.kind === "group"
  );
}

function isElement(value: unknown): value is LeaferElement {
  return (
    typeof value === "object" && value !== null && "localTransform" in value
  );
}

function isLineTool(tool: LeaferBoxCreateTool): boolean {
  return tool === "line" || tool === "arrow";
}

function isLockedSpec(spec: LeaferElementSpec | undefined): boolean {
  const metadata = spec?.data.data;
  return (
    typeof metadata === "object" &&
    metadata !== null &&
    (metadata as Record<string, unknown>).opendesignLocked === true
  );
}

function rectFromPoints(
  start: Point,
  end: Point,
  constrain: boolean,
  fromCenter: boolean,
): { height: number; width: number; x: number; y: number } {
  let width = end.x - start.x;
  let height = end.y - start.y;
  if (constrain) {
    const size = Math.max(Math.abs(width), Math.abs(height));
    width = Math.sign(width || 1) * size;
    height = Math.sign(height || 1) * size;
  }
  return {
    x: fromCenter
      ? start.x - Math.abs(width)
      : Math.min(start.x, start.x + width),
    y: fromCenter
      ? start.y - Math.abs(height)
      : Math.min(start.y, start.y + height),
    width: Math.max(1, Math.abs(width) * (fromCenter ? 2 : 1)),
    height: Math.max(1, Math.abs(height) * (fromCenter ? 2 : 1)),
  };
}

function lineEndpointsFromDrag(
  origin: Point,
  pointer: Point,
  constrain: boolean,
  fromCenter: boolean,
): { end: Point; start: Point } {
  let x = pointer.x - origin.x;
  let y = pointer.y - origin.y;
  if (constrain && (x !== 0 || y !== 0)) {
    const distance = Math.hypot(x, y);
    const angle = Math.round(Math.atan2(y, x) / (Math.PI / 4)) * (Math.PI / 4);
    x = Math.cos(angle) * distance;
    y = Math.sin(angle) * distance;
  }
  return fromCenter
    ? {
        start: { x: origin.x - x, y: origin.y - y },
        end: { x: origin.x + x, y: origin.y + y },
      }
    : { start: origin, end: { x: origin.x + x, y: origin.y + y } };
}
