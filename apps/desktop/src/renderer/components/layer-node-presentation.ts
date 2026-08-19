import type { NodeKind } from "@opendesign/design-contracts";
import type { IconName } from "@opendesign/ui";
import type { MessageKey } from "../../shared/i18n/messages";

export const layerNodeIcons: Record<NodeKind, IconName> = {
  frame: "lucide:frame",
  slot: "lucide:frame",
  group: "lucide:layers",
  boolean: "lucide:combine",
  rectangle: "lucide:rectangle-horizontal",
  ellipse: "lucide:circle",
  line: "lucide:slash",
  polygon: "lucide:pentagon",
  star: "lucide:star",
  text: "lucide:type",
  image: "lucide:image",
  vector: "lucide:pen",
  path: "lucide:pen",
  instance: "lucide:diamond",
  slice: "lucide:frame",
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
