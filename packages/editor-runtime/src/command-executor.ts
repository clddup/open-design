import type {
  DesignDocument,
  DesignOperation,
} from "@opendesign/design-contracts";
import { applyAssetCommand } from "./asset-command-executor.js";
import { applyComponentSourceCommand } from "./component-source-command-executor.js";
import { applyDesignSystemOperation } from "./design-system-runtime.js";
import { applyElementCommand } from "./element-command-executor.js";
import { applyPageCommand } from "./page-command-executor.js";
import {
  applyTextCommand,
  type TextCommandContext,
} from "./text-command-executor.js";
import { deleteVariantSet, putVariantSet } from "./variant-set-runtime.js";

export function applyCommand(
  document: DesignDocument,
  command: DesignOperation,
  context: TextCommandContext,
): void {
  if (applyElementCommand(document, command, context)) return;
  if (applyAssetCommand(document, command)) return;
  if (applyComponentSourceCommand(document, command)) return;
  if (applyPageCommand(document, command)) return;
  if (applyTextCommand(document, command, context)) return;
  switch (command.type) {
    case "put_variant_set":
      putVariantSet(document, command);
      return;
    case "delete_variant_set":
      deleteVariantSet(document, command);
      return;
    default:
      applyDesignSystemOperation(document, command);
  }
}
