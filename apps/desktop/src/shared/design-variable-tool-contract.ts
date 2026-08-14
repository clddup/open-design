import type {
  VariableBindingTarget,
  VariableResolvedDataType,
  VariableScope,
  VariableValue,
} from "@opendesign/design-contracts";

type Base = { label: string; pageId: string };

export type DesignVariableToolInput =
  | (Base & {
      action: "create-collection";
      collectionId: string;
      key: string;
      name: string;
      defaultModeId: string;
      defaultModeName: string;
    })
  | (Base & {
      action: "rename-collection";
      collectionId: string;
      name: string;
    })
  | (Base & { action: "delete-collection"; collectionId: string })
  | (Base & {
      action: "add-mode";
      collectionId: string;
      modeId: string;
      name: string;
      valuesByVariableId: Record<string, VariableValue>;
    })
  | (Base & {
      action: "rename-mode";
      collectionId: string;
      modeId: string;
      name: string;
    })
  | (Base & {
      action: "remove-mode";
      collectionId: string;
      modeId: string;
      replacementModeId: string;
    })
  | (Base & {
      action: "create-variable";
      variableId: string;
      key: string;
      collectionId: string;
      name: string;
      resolvedType: VariableResolvedDataType;
      valuesByMode: Record<string, VariableValue>;
      scopes: VariableScope[];
    })
  | (Base & {
      action: "set-value";
      variableId: string;
      modeId: string;
      value: VariableValue;
    })
  | (Base & {
      action: "update-variable";
      variableId: string;
      name?: string;
      description?: string;
      scopes?: VariableScope[];
      hiddenFromPublishing?: boolean;
      codeSyntax?: { WEB?: string; ANDROID?: string; iOS?: string };
    })
  | (Base & { action: "delete-variable"; variableId: string })
  | (Base & {
      action: "set-binding";
      target: VariableBindingTarget;
      variableId: string | null;
    })
  | (Base & {
      action: "set-mode";
      target: { kind: "page" | "node"; id: string };
      collectionId: string;
      modeId: string | null;
    });
