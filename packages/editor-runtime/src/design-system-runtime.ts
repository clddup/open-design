import type {
  DesignChangeSet,
  DesignDocument,
  DesignOperation,
} from "@opendesign/design-contracts";
import { diffStyles } from "./style-diff.js";
import { applyStyleOperation } from "./style-runtime.js";
import { diffVariables } from "./variable-diff.js";
import { applyVariableOperation } from "./variable-runtime.js";

export function applyDesignSystemOperation(
  document: DesignDocument,
  command: DesignOperation,
): boolean {
  if (
    command.type === "put_variable_collection" ||
    command.type === "delete_variable_collection" ||
    command.type === "move_variable_collection" ||
    command.type === "put_variable" ||
    command.type === "delete_variable" ||
    command.type === "set_explicit_variable_modes" ||
    command.type === "set_variable_binding" ||
    command.type === "put_library_variable_collection_source" ||
    command.type === "delete_library_variable_collection_source" ||
    command.type === "put_library_variable_source" ||
    command.type === "delete_library_variable_source"
  ) {
    applyVariableOperation(document, command);
    return true;
  }
  if (
    command.type === "put_style" ||
    command.type === "delete_style" ||
    command.type === "move_style" ||
    command.type === "set_style_reference" ||
    command.type === "put_library_style_source" ||
    command.type === "delete_library_style_source"
  ) {
    applyStyleOperation(document, command);
    return true;
  }
  return false;
}

export function diffDesignSystems(
  before: DesignDocument,
  after: DesignDocument,
): Partial<DesignChangeSet> {
  return { ...diffVariables(before, after), ...diffStyles(before, after) };
}
