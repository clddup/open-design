import { Type, type Static, type TSchema } from "@sinclair/typebox";

export {
  schemaValidationIssues,
  type SchemaValidationIssue,
} from "@opendesign/contract-runtime";
export { Type, type Static, type TSchema };
export { executableJsonSchema } from "./schema-check.js";
export * from "./component-properties.js";
export * from "./variant-sets.js";
export * from "./primitives.js";
export * from "./versions.js";
export * from "./variables.js";
export * from "./styles.js";
export * from "./appearance.js";
export * from "./export-settings.js";
export * from "./image-filters.js";
export {
  TextDecorationAdvancedProperties,
  advancedTextDecorationIssue,
  defaultAdvancedTextDecoration,
  migrateAdvancedTextDecoration,
} from "./text-decoration.js";
export * from "./layout.js";
export * from "./guides.js";
export * from "./limits.js";
export * from "./node-paints.js";
export * from "./schema-registry.js";
export * from "./public-types.js";
export * from "./vector-topology.js";
export * from "./contract-facade.js";
export * from "./design-quality.js";
export { designDocumentDomainIssues } from "./document-domain.js";
export {
  designCommandListDomainIssues,
  designOperationDomainIssues,
  designTransactionDomainIssues,
} from "./operation-domain.js";
export {
  normalizeLineEndpoints,
  resolveLineEndpointPoint,
  resolveRegularPolygonPoints,
  resolveStarPoints,
} from "./regular-geometry.js";
