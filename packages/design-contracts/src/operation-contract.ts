import type { TSchema } from "@sinclair/typebox";
import { defineContract } from "@opendesign/contract-runtime";
import {
  designOperationDomainIssues,
  designTransactionDomainIssues,
} from "./operation-domain.js";
import type { DesignOperation, DesignTransaction } from "./public-types.js";

export function createDesignOperationContract(schema: TSchema) {
  return defineContract<DesignOperation>({
    schema,
    code: "design.operation_structure_invalid",
    subject: "design operation",
    refine: designOperationDomainIssues,
    clone: false,
  });
}

export function createDesignTransactionContract(schema: TSchema) {
  return defineContract<DesignTransaction>({
    schema,
    code: "design.transaction_structure_invalid",
    subject: "design transaction",
    refine: designTransactionDomainIssues,
    clone: false,
  });
}
