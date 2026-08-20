import type {
  ComponentSelectionTarget,
  UpdatePropertiesCommand,
} from "@opendesign/design-contracts";

export type UpdatePropertiesPatch = Omit<
  UpdatePropertiesCommand,
  "commandId" | "nodeId" | "type"
>;

export type PageActionResult =
  { ok: true; pageId: string; name?: string } | { ok: false; error: string };

export type LayerActionResult = { ok: true } | { ok: false; error: string };

export type LayerRenameTarget = {
  nodeId: string;
  componentTarget?: ComponentSelectionTarget;
};

export type LayerDropPosition = "before" | "inside" | "after";

export type LayerReparentRequest = {
  nodeIds: readonly string[];
  parentId: string | null;
  index: number;
  position: LayerDropPosition;
  targetNodeId: string;
};

export type LayerReparentResult =
  { ok: true; warning?: string } | { ok: false; error: string };
