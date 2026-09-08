import { defineContract } from "./contract-validation";
import type {
  LOGO_CONCEPT_PRINCIPLES,
  DesignLogoOutput,
} from "./design-agent-plan-review";
import { compileValidatedDesignGenerationToolInput } from "./design-generation-compiler";
import {
  DESIGN_GENERATION_CANONICAL_INPUT_SCHEMA,
  DESIGN_GENERATION_TOOL_INPUT_SCHEMA,
  type DesignGenerationCanonicalInput,
  type DesignGenerationElementInput,
  type DesignGenerationModelInput,
} from "./design-generation-tool-schema";
import type { DesignLogoColorStrategy } from "./design-logo-color";
import { bindDesignGenerationHostContext } from "./design-generation-host-binding";
import { refineDesignGeneration } from "./design-generation-refinement";

export { DESIGN_GENERATION_TOOL_INPUT_SCHEMA } from "./design-generation-tool-schema";

export type DesignGenerationElement = DesignGenerationElementInput;
export type DesignGenerationToolInput = Omit<
  DesignGenerationCanonicalInput,
  "logoColorStrategy" | "logoOutputs" | "logoExploration"
> & {
  logoColorStrategy?: DesignLogoColorStrategy;
  logoOutputs?: DesignLogoOutput[];
  logoExploration?: {
    targetId: string;
    directions: Array<{
      conceptId: string;
      principle: (typeof LOGO_CONCEPT_PRINCIPLES)[number];
      thesis: string;
      constructionLogic: string;
      colorSystem: {
        palette: string[];
        rationale: string;
      };
      rootNodeId: string;
      masterNodeId: string;
    }>;
  };
};

export type DesignGenerationContractContext = {
  authoritativePrompt?: string;
  newNodeIdPrefix?: string;
  target?: DesignGenerationTargetBinding;
};

export type DesignGenerationTargetBinding = {
  targetId: string;
  pageId: string;
  frame: {
    frameId: string;
    x: number;
    y: number;
    width?: number;
    height?: number;
  };
  label?: string;
  objective?: string;
};

export const DesignGenerationContract = defineContract<
  DesignGenerationModelInput,
  DesignGenerationToolInput,
  DesignGenerationContractContext
>(
  {
    schema: DESIGN_GENERATION_TOOL_INPUT_SCHEMA,
    code: "design_generation.schema_invalid",
    subject: "Design Generation",
    maximum: 32,
    canonical: {
      schema: DESIGN_GENERATION_CANONICAL_INPUT_SCHEMA,
      code: "design_generation.host_binding_invalid",
      subject: "host-bound Design Generation",
      maximum: 32,
    },
    bind: bindDesignGenerationHostContext,
    refine: refineDesignGeneration,
  },
  () => ({}),
);

/** Input must come from DesignGenerationContract.parse. */
export function compileDesignGenerationToolInput(
  input: DesignGenerationToolInput,
): ReturnType<typeof compileValidatedDesignGenerationToolInput> {
  return compileValidatedDesignGenerationToolInput(input);
}
