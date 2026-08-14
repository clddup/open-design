import type { NodeKind } from "@opendesign/design-contracts";
import type { GlyphName } from "@opendesign/ui";
import type { MessageKey } from "../../shared/i18n/messages";

export const layerNodeIcons: Record<NodeKind, GlyphName> = {
  frame: "frame",
  slot: "frame",
  group: "layers",
  boolean: "boolean",
  rectangle: "rectangle",
  ellipse: "ellipse",
  line: "line",
  polygon: "polygon",
  star: "star",
  text: "text",
  image: "assets",
  vector: "pen",
  path: "pen",
  instance: "instance",
  slice: "frame",
};

export const layerNodeKindKeys: Record<NodeKind, MessageKey> = {
  frame: "node.frame",
  slot: "node.slot",
  group: "node.group",
  boolean: "node.boolean",
  rectangle: "node.rectangle",
  ellipse: "node.ellipse",
  line: "node.line",
  polygon: "node.polygon",
  star: "node.star",
  text: "node.text",
  image: "node.image",
  vector: "node.vector",
  path: "node.path",
  instance: "node.instance",
  slice: "node.slice",
};
