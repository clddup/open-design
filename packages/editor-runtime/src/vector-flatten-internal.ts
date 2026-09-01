import type {
  FrameLikeNode,
  ImageNode,
  RectangleNode,
  TextNode,
  Transform,
} from "@opendesign/design-contracts";
import type { FlattenSourceNode } from "./vector-flatten-shapes.js";

export type FlattenFailure = {
  ok: false;
  code:
    "invalid-geometry" | "requires-raster-compositing" | "unsupported-topology";
  message: string;
};

export type FlattenClip = {
  node: RectangleNode;
  transform: Transform;
};

export type FlattenSourceEntry = {
  clips: readonly FlattenClip[];
  contribution: "all" | "fill" | "stroke";
  node: FlattenSourceNode | FrameLikeNode | ImageNode | TextNode;
  transform: Transform;
};

export type ResolvedFlattenSourceEntry = {
  clips: readonly FlattenClip[];
  node: FlattenSourceNode | TextNode;
};

export function flattenFailure(
  code: FlattenFailure["code"],
  message: string,
): FlattenFailure {
  return { ok: false, code, message };
}
