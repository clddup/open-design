import type { TSchema } from "@sinclair/typebox";
import { defineContract } from "@opendesign/contract-runtime";
import { designTransactionResultDomainIssues } from "./transaction-result-domain.js";
import type { DesignTransactionResult } from "./public-types.js";

export function createDesignTransactionResultContract(schema: TSchema) {
  return defineContract<DesignTransactionResult>({
    schema,
    code: "design.result_structure_invalid",
    subject: "design transaction result",
    refine: designTransactionResultDomainIssues,
    clone: false,
  });
}
