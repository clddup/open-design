import type { ComponentSelectionTarget } from "@opendesign/design-contracts";

/**
 * Disposable workbench identity used to connect Layers-panel hover with the
 * current canvas projection. It never enters DesignDocument or history.
 */
export interface LayerHoverTarget {
  componentTarget?: ComponentSelectionTarget;
  nodeId: string;
}
