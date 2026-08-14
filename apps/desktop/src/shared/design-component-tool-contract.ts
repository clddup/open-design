import type {
  ComponentPropertyAssignment,
  ComponentPropertyType,
  InstanceSwapPreferredValue,
  SlotSettings,
} from "@opendesign/design-contracts";

export type DesignComponentToolInput =
  | {
      action: "create-component";
      label: string;
      pageId: string;
      nodeId: string;
      componentId: string;
      name: string;
    }
  | {
      action: "create-instance";
      label: string;
      pageId: string;
      componentId: string;
      instanceId: string;
      parentId: string | null;
      index: number;
      x: number;
      y: number;
      name?: string;
    }
  | {
      action: "remove-component";
      label: string;
      pageId: string;
      componentId: string;
    }
  | {
      action: "combine-as-variants";
      label: string;
      pageId: string;
      componentIds: string[];
      componentRootNodeIds: string[];
      variantSetId: string;
      rootNodeId: string;
      name: string;
      variantPropertiesByComponentId: Record<string, Record<string, string>>;
    }
  | {
      action: "add-component-to-variant-set";
      label: string;
      pageId: string;
      variantSetId: string;
      rootNodeId: string;
      componentId: string;
      componentRootNodeId: string;
      variantProperties: Record<string, string>;
    }
  | {
      action: "duplicate-variant";
      label: string;
      pageId: string;
      variantSetId: string;
      rootNodeId: string;
      sourceComponentId: string;
      sourceRootNodeId: string;
      componentId: string;
      componentRootNodeId: string;
      name?: string;
      variantProperties: Record<string, string>;
    }
  | {
      action: "remove-variant";
      label: string;
      pageId: string;
      variantSetId: string;
      rootNodeId: string;
      componentId: string;
      componentRootNodeId: string;
    }
  | {
      action: "dissolve-variant-set";
      label: string;
      pageId: string;
      variantSetId: string;
      rootNodeId: string;
    }
  | {
      action: "add-variant-property";
      label: string;
      pageId: string;
      variantSetId: string;
      rootNodeId: string;
      propertyName: string;
      valuesByComponentId: Record<string, string>;
      index?: number;
    }
  | {
      action: "rename-variant-property";
      label: string;
      pageId: string;
      variantSetId: string;
      rootNodeId: string;
      propertyName: string;
      name: string;
    }
  | {
      action: "reorder-variant-properties";
      label: string;
      pageId: string;
      variantSetId: string;
      rootNodeId: string;
      propertyOrder: string[];
    }
  | {
      action: "remove-variant-property";
      label: string;
      pageId: string;
      variantSetId: string;
      rootNodeId: string;
      propertyName: string;
    }
  | {
      action: "rename-variant-value";
      label: string;
      pageId: string;
      variantSetId: string;
      rootNodeId: string;
      propertyName: string;
      value: string;
      name: string;
    }
  | {
      action: "reorder-variant-values";
      label: string;
      pageId: string;
      variantSetId: string;
      rootNodeId: string;
      propertyName: string;
      values: string[];
    }
  | {
      action: "set-variant-properties";
      label: string;
      pageId: string;
      variantSetId: string;
      rootNodeId: string;
      componentId: string;
      componentRootNodeId: string;
      variantProperties: Record<string, string>;
    }
  | {
      action: "add-property";
      label: string;
      pageId: string;
      componentId: string;
      propertyId: string;
      name: string;
      type: ComponentPropertyType;
      sourceNodeId: string;
      preferredValues?: InstanceSwapPreferredValue[];
    }
  | {
      action: "rename-property";
      label: string;
      pageId: string;
      componentId: string;
      propertyName: string;
      name: string;
    }
  | {
      action: "remove-property";
      label: string;
      pageId: string;
      componentId: string;
      propertyName: string;
    }
  | {
      action: "set-property";
      label: string;
      pageId: string;
      instanceId: string;
      propertyName: string;
      value: ComponentPropertyAssignment;
    }
  | {
      action: "reset-property";
      label: string;
      pageId: string;
      instanceId: string;
      propertyName: string;
    }
  | {
      action: "create-slot-override" | "clear-slot" | "reset-slot";
      label: string;
      pageId: string;
      instanceId: string;
      propertyName: string;
    }
  | {
      action: "set-slot-settings";
      label: string;
      pageId: string;
      componentId: string;
      propertyName: string;
      settings: SlotSettings;
      preferredValues?: InstanceSwapPreferredValue[];
      description?: string;
    }
  | {
      action: "set-override";
      label: string;
      pageId: string;
      instanceId: string;
      sourcePath: string[];
      patch: Record<string, unknown>;
    }
  | {
      action: "reset-overrides";
      label: string;
      pageId: string;
      instanceId: string;
      sourcePath?: string[];
    }
  | {
      action: "detach-instance";
      label: string;
      pageId: string;
      instanceId: string;
    }
  | {
      action: "go-to-main";
      pageId: string;
      instanceId: string;
    };
