import type { StyleReferenceTarget } from "@opendesign/design-contracts";

type Base = { label: string; pageId: string };

export type DesignStyleToolInput =
  | (Base & {
      action: "create-from-node";
      nodeId: string;
      field: StyleReferenceTarget["field"];
      styleId: string;
      key: string;
      name: string;
      description?: string;
    })
  | (Base & {
      action: "update-from-node";
      nodeId: string;
      field: StyleReferenceTarget["field"];
      styleId: string;
    })
  | (Base & {
      action: "update-metadata";
      styleId: string;
      name?: string;
      description?: string;
      hiddenFromPublishing?: boolean;
    })
  | (Base & { action: "move"; styleId: string; index: number })
  | (Base & { action: "delete"; styleId: string })
  | (Base & {
      action: "set-reference";
      nodeId: string;
      field: StyleReferenceTarget["field"];
      styleId: string | null;
    });
