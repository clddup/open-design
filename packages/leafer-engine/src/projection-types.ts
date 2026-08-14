import type { DesignNode, Transform } from "@opendesign/design-contracts";
import type { LeaferFidelityWarning } from "./types.js";

export type LeaferElementTag =
  | "Arrow"
  | "Ellipse"
  | "Frame"
  | "Group"
  | "Image"
  | "Path"
  | "Polygon"
  | "Rect"
  | "Star"
  | "Text";

export interface LeaferElementSpec {
  childIds: string[];
  data: Record<string, unknown>;
  id: string;
  kind: DesignNode["kind"];
  parentId: string | null;
  tag: LeaferElementTag;
  transform: Transform;
}

export interface LeaferSceneProjection {
  affectedNodeIds?: ReadonlySet<string>;
  elementsById: ReadonlyMap<string, LeaferElementSpec>;
  pageId: string;
  revision: number;
  rootIds: string[];
  warnings: LeaferFidelityWarning[];
}

export interface BooleanProjectionOptions {
  affectedBooleanNodeIds?: ReadonlySet<string>;
  removedBooleanNodeIds?: ReadonlySet<string>;
}

export interface BooleanEditProjectionOptions {
  affectedBooleanNodeIds?: ReadonlySet<string>;
  forceAffected?: boolean;
}
