import type { DesignStyleToolInput } from "./design-style-tool-contract";
import { DESIGN_STYLE_TOOL_INPUT_SCHEMA } from "./design-style-tool-schema";
import { defineContract } from "./contract-validation";

export type { DesignStyleToolInput } from "./design-style-tool-contract";

export const DesignStyleContract = defineContract<DesignStyleToolInput>({
  schema: DESIGN_STYLE_TOOL_INPUT_SCHEMA,
  code: "design_style.schema_invalid",
  subject: "Style",
  maximum: 24,
});
