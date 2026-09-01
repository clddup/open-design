import type { TSchema } from "@sinclair/typebox";
import {
  defineContract,
  selectDiscriminatedUnionSchema,
  type Contract,
} from "@opendesign/contract-runtime";
import { designTransactionResultDomainIssues } from "./transaction-result-domain.js";
import type { DesignTransactionResult } from "./public-types.js";

export function createDesignTransactionResultContract(
  schema: TSchema,
): Contract<DesignTransactionResult> {
  return defineContract<DesignTransactionResult>({
    schema,
    code: "design.result_structure_invalid",
    subject: "design transaction result",
    selectSchema: (input) =>
      selectDiscriminatedUnionSchema(schema, input, "ok"),
    refine: designTransactionResultDomainIssues,
    clone: false,
  });
}
