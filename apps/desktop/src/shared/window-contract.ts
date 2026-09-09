import { Type, type Static } from "@sinclair/typebox";
import { defineContract } from "./contract-validation";
import { PortableFileNameSchema } from "./portable-file-name";

const UnsavedDesignDecisionSchema = Type.Union([
  Type.Literal("save"),
  Type.Literal("discard"),
  Type.Literal("cancel"),
]);
export type UnsavedDesignDecision = Static<typeof UnsavedDesignDecisionSchema>;
export const UnsavedDesignDecisionContract =
  defineContract<UnsavedDesignDecision>({
    schema: UnsavedDesignDecisionSchema,
    code: "window.unsaved_decision_invalid",
    subject: "Unsaved design decision",
  });
export const UnsavedDesignNameContract = defineContract<string>({
  schema: PortableFileNameSchema,
  code: "window.unsaved_name_invalid",
  subject: "Unsaved design name",
});
export const MaximizedWindowContract = defineContract<boolean>({
  schema: Type.Boolean(),
  code: "window.maximized_invalid",
  subject: "Window maximized state",
});
const WindowCommandSchema = Type.Union([
  Type.Literal("settings:open"),
  Type.Literal("svg:import-command"),
  Type.Literal("svg:export-command"),
]);
export type WindowCommand = Static<typeof WindowCommandSchema>;
export const WindowCommandContract = defineContract<WindowCommand>({
  schema: WindowCommandSchema,
  code: "window.command_invalid",
  subject: "Window command",
});
