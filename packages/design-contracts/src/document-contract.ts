import { type TSchema } from "@sinclair/typebox";
import { defineContract } from "@opendesign/contract-runtime";
import { designDocumentDomainIssues } from "./document-domain.js";
import type { DesignDocument } from "./index.js";

export function createDesignDocumentContract(schema: TSchema) {
  return defineContract<DesignDocument>({
    schema,
    code: "design.document_structure_invalid",
    subject: "OpenDesign document",
    refine: designDocumentDomainIssues,
    clone: false,
  });
}
