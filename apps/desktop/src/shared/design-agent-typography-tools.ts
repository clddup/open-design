import {
  DESIGN_FONT_TOOL_INPUT_SCHEMA,
  DESIGN_TEXT_RANGE_TOOL_INPUT_SCHEMA,
} from "./design-agent-typography-tool-schema";
import type {
  DesignFontToolInput,
  DesignTextRangeToolInput,
} from "./design-agent-typography-tool-types";
import { defineContract } from "./contract-validation";

export {
  DESIGN_FONT_TOOL_INPUT_SCHEMA,
  DESIGN_TEXT_RANGE_TOOL_INPUT_SCHEMA,
} from "./design-agent-typography-tool-schema";
export type {
  DesignFontToolInput,
  DesignTextRangeToolInput,
} from "./design-agent-typography-tool-types";

export const DesignFontContract = defineContract<DesignFontToolInput>({
  schema: DESIGN_FONT_TOOL_INPUT_SCHEMA,
  code: "design_font.schema_invalid",
  subject: "Font",
  maximum: 24,
});

export const DesignTextRangeContract = defineContract<DesignTextRangeToolInput>(
  {
    schema: DESIGN_TEXT_RANGE_TOOL_INPUT_SCHEMA,
    code: "design_text_range.schema_invalid",
    subject: "Text Range",
    maximum: 24,
    refine: (value) => {
      if (value.end <= value.start) {
        return [
          {
            code: "design_text_range.range_empty",
            path: "/end",
            message: "end must be greater than start for a non-empty range",
            expected: { exclusiveMinimum: value.start },
            actual: value.end,
            recovery:
              "Inspect the current Text content and submit a non-empty UTF-16 [start,end) range without guessing offsets.",
          },
        ];
      }
      return [];
    },
  },
);
