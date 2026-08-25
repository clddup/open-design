import type {
  AutoLayout,
  GridChildPlacement,
  LayoutConstraints,
  LayoutGuide,
  LayoutLimits,
  LayoutPositioning,
  LayoutSizing,
} from "@opendesign/design-contracts";

export type DesignArrangeToolInput =
  | {
      action: "repair-overflow";
      label: string;
      pageId: string;
      frameId: string;
    }
  | {
      action: "reorder-grid-tracks";
      label: string;
      pageId: string;
      frameId: string;
      axis: "rows" | "columns";
      fromIndices: number[];
      insertionIndex: number;
    }
  | {
      action: "set-grid-placement";
      label: string;
      pageId: string;
      nodeId: string;
      placement: GridChildPlacement;
    }
  | {
      action:
        | "align-left"
        | "align-horizontal-center"
        | "align-right"
        | "align-top"
        | "align-vertical-center"
        | "align-bottom"
        | "distribute-horizontal"
        | "distribute-vertical"
        | "tidy-up";
      label: string;
      pageId: string;
      nodeIds: string[];
    }
  | {
      action: "set-horizontal-spacing" | "set-vertical-spacing";
      label: string;
      pageId: string;
      nodeIds: string[];
      spacing: number;
    }
  | {
      action: "set-constraints";
      label: string;
      pageId: string;
      nodeId: string;
      constraints: LayoutConstraints;
    }
  | {
      action: "resize-frame";
      label: string;
      pageId: string;
      frameId: string;
      width: number;
      height: number;
    }
  | {
      action: "set-auto-layout";
      label: string;
      pageId: string;
      frameId: string;
      autoLayout: AutoLayout;
    }
  | {
      action: "set-layout-sizing";
      label: string;
      pageId: string;
      nodeId: string;
      sizing: LayoutSizing;
    }
  | {
      action: "set-layout-positioning";
      label: string;
      pageId: string;
      nodeId: string;
      positioning: "flow" | LayoutPositioning;
      constraints?: LayoutConstraints;
    }
  | {
      action: "set-layout-limits";
      label: string;
      pageId: string;
      nodeId: string;
      limits: LayoutLimits | null;
    }
  | {
      action: "set-layout-guides";
      label: string;
      pageId: string;
      frameId: string;
      layoutGuides: LayoutGuide[];
    };
