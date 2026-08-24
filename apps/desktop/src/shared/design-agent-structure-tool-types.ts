import type {
  BooleanOperation,
  Point,
  Transform,
} from "@opendesign/design-contracts";

export type DesignHierarchyToolInput =
  | {
      action: "group";
      label: string;
      pageId: string;
      nodeIds: string[];
      groupId: string;
      name: string;
    }
  | {
      action: "ungroup";
      label: string;
      pageId: string;
      groupId: string;
    }
  | {
      action: "create-mask";
      label: string;
      pageId: string;
      nodeIds: string[];
      groupId: string;
      name: string;
      maskType: "alpha" | "vector" | "luminance";
    }
  | {
      action: "set-mask-type";
      label: string;
      pageId: string;
      maskNodeId: string;
      maskType: "alpha" | "vector" | "luminance";
    }
  | {
      action: "remove-mask";
      label: string;
      pageId: string;
      maskNodeId: string;
    }
  | {
      action: "create-boolean";
      label: string;
      pageId: string;
      nodeIds: string[];
      booleanId: string;
      name: string;
      operation: BooleanOperation;
    }
  | {
      action: "set-boolean-operation";
      label: string;
      pageId: string;
      booleanId: string;
      operation: BooleanOperation;
    }
  | {
      action: "ungroup-boolean";
      label: string;
      pageId: string;
      booleanId: string;
    }
  | {
      action: "reorder";
      label: string;
      pageId: string;
      nodeIds: string[];
      order:
        "bring-forward" | "bring-to-front" | "send-backward" | "send-to-back";
    }
  | {
      action: "reparent";
      label: string;
      pageId: string;
      nodeIds: string[];
      parentId: string | null;
      index: number;
    };

export type DesignVectorToolInput =
  | {
      action: "set-closed";
      closed: boolean;
      label: string;
      nodeId: string;
      pageId: string;
      pathId?: string;
    }
  | {
      action: "reverse-path";
      label: string;
      nodeId: string;
      pageId: string;
      pathId?: string;
    }
  | {
      action: "connect-endpoints";
      label: string;
      nodeId: string;
      pageId: string;
      vertexIds: [string, string];
    }
  | {
      action: "disconnect-vertex";
      label: string;
      nodeId: string;
      pageId: string;
      pathId: string;
      vertexId: string;
    }
  | {
      action: "transform-vertices";
      label: string;
      nodeId: string;
      pageId: string;
      transform: Transform;
      vertexIds: string[];
    }
  | {
      action: "transform-layers-vertices";
      label: string;
      pageId: string;
      targets: { nodeId: string; vertexIds: string[] }[];
      transform: Transform;
    }
  | {
      action: "cut-path";
      at:
        | { kind: "vertex"; vertexId: string }
        | { kind: "segment"; segmentId: string; t: number };
      label: string;
      nodeId: string;
      pageId: string;
      pathId: string;
    }
  | {
      action: "cut-with-line";
      end: Point;
      label: string;
      nodeId: string;
      pageId: string;
      start: Point;
    }
  | {
      action: "cut-layers-with-line";
      end: Point;
      label: string;
      nodeIds: string[];
      pageId: string;
      start: Point;
    };
