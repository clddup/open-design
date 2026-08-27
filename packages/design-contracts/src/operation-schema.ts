import { Type, type TSchema } from "@sinclair/typebox";

export function createDesignOperationSchema<
  TNodeSchema extends TSchema,
  const TDocumentSchemas extends TSchema[],
>(nodeSchema: TNodeSchema, documentSchemas: TDocumentSchemas) {
  const allSchemas: [TNodeSchema, ...TDocumentSchemas] = [
    nodeSchema,
    ...documentSchemas,
  ];
  return Type.Union(allSchemas);
}
