import { checkSchema } from "./schema-check.js";
import type { Contract } from "@opendesign/contract-runtime";
import { createDesignDocumentContract } from "./document-contract.js";
import { migrateDesignDocumentValue } from "./document-migration.js";
import {
  createDesignOperationContract,
  createDesignTransactionContract,
} from "./operation-contract.js";
import { createDesignTransactionResultContract } from "./transaction-result-contract.js";
import { isVariableAliasValue } from "./variables.js";
import type { ImageFilters } from "./image-filters.js";
import * as schema from "./schema-registry.js";
import type {
  DesignAsset,
  DesignDocument,
  DesignOperation,
  DesignTransaction,
  DesignTransactionResult,
  EditorEvent,
  ImageAssetDerivation,
  ImageLightingPreset,
  ImagePaint,
  ImagePlacement,
  LibraryReleaseIdentity,
  LibraryReleaseSnapshot,
} from "./public-types.js";

export function isDesignDocument(value: unknown): value is DesignDocument {
  return DesignDocumentContract.parse(value).ok;
}

export const DesignDocumentContract = createDesignDocumentContract(
  schema.DesignDocumentSchema,
);

export function isDesignAsset(value: unknown): value is DesignAsset {
  return checkSchema(schema.DesignAssetSchema, value);
}

export function isImageAssetDerivation(
  value: unknown,
): value is ImageAssetDerivation {
  return checkSchema(schema.ImageAssetDerivationSchema, value);
}

export function isImageLightingPreset(
  value: unknown,
): value is ImageLightingPreset {
  return checkSchema(schema.ImageLightingPresetSchema, value);
}

export function isLibraryReleaseSnapshot(
  value: unknown,
): value is LibraryReleaseSnapshot {
  if (!checkSchema(schema.LibraryReleaseSnapshotSchema, value)) return false;
  const release = value as LibraryReleaseSnapshot;
  const identityMatches = (
    source: LibraryReleaseIdentity,
    sourceEntityId: string,
    entityId: string,
  ) =>
    source.libraryId === release.libraryId &&
    source.releaseId === release.releaseId &&
    source.sourceProjectId === release.sourceProjectId &&
    source.sourceDesignFileId === release.sourceDesignFileId &&
    source.sourceDocumentId === release.sourceDocumentId &&
    sourceEntityId === entityId;
  return (
    Object.entries(release.componentsById).every(
      ([componentId, component]) =>
        component.component.id === componentId &&
        identityMatches(
          component.source,
          component.source.sourceComponentId,
          componentId,
        ),
    ) &&
    Object.entries(release.variantSetsById).every(
      ([variantSetId, variantSet]) =>
        variantSet.variantSet.id === variantSetId &&
        identityMatches(
          variantSet.source,
          variantSet.source.sourceVariantSetId,
          variantSetId,
        ),
    ) &&
    Object.entries(release.stylesById).every(
      ([styleId, style]) =>
        style.style.id === styleId &&
        identityMatches(style.source, style.source.sourceStyleId, styleId),
    ) &&
    Object.entries(release.variableCollectionsById).every(
      ([collectionId, source]) =>
        source.collection.id === collectionId &&
        identityMatches(
          source.source,
          source.source.sourceVariableCollectionId,
          collectionId,
        ) &&
        source.collection.variableIds.every(
          (variableId) =>
            release.variablesById[variableId]?.variable.variableCollectionId ===
            collectionId,
        ),
    ) &&
    Object.entries(release.variablesById).every(
      ([variableId, source]) =>
        source.variable.id === variableId &&
        identityMatches(
          source.source,
          source.source.sourceVariableId,
          variableId,
        ) &&
        Boolean(
          release.variableCollectionsById[
            source.variable.variableCollectionId
          ]?.collection.variableIds.includes(variableId),
        ) &&
        Object.values(source.variable.valuesByMode).every(
          (value) =>
            !isVariableAliasValue(value) ||
            release.variablesById[value.id]?.variable.resolvedType ===
              source.variable.resolvedType,
        ),
    )
  );
}

export function migrateLibraryReleaseSnapshot(
  value: unknown,
): LibraryReleaseSnapshot | null {
  if (isLibraryReleaseSnapshot(value)) return structuredClone(value);
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (value as { version?: unknown }).version !== 2
  ) {
    return null;
  }
  const migrated = structuredClone(value) as Record<string, unknown>;
  migrated.version = 3;
  migrated.variableCollectionsById = {};
  migrated.variablesById = {};
  return isLibraryReleaseSnapshot(migrated) ? migrated : null;
}

export function isImagePlacement(value: unknown): value is ImagePlacement {
  return checkSchema(schema.ImagePlacementSchema, value);
}
export function isImageFilters(value: unknown): value is ImageFilters {
  return checkSchema(schema.ImageFiltersSchema, value);
}
export function isImagePaint(value: unknown): value is ImagePaint {
  return checkSchema(schema.ImagePaintSchema, value);
}
export function migrateDesignDocument(value: unknown): DesignDocument | null {
  return migrateDesignDocumentValue(value, (candidate) => {
    const parsed = DesignDocumentContract.parse(candidate);
    return parsed.ok ? parsed.value : null;
  });
}

export function isDesignOperation(value: unknown): value is DesignOperation {
  return DesignOperationContract.parse(value).ok;
}

export const DesignOperationContract = createDesignOperationContract(
  schema.DesignOperationSchema,
);

export function isDesignTransaction(
  value: unknown,
): value is DesignTransaction {
  return DesignTransactionContract.parse(value).ok;
}

export const DesignTransactionContract = createDesignTransactionContract(
  schema.DesignTransactionSchema,
);

export function isDesignTransactionResult(
  value: unknown,
): value is DesignTransactionResult {
  return DesignTransactionResultContract.parse(value).ok;
}

export const DesignTransactionResultContract: Contract<DesignTransactionResult> =
  createDesignTransactionResultContract(schema.DesignTransactionResultSchema);

export function isEditorEvent(value: unknown): value is EditorEvent {
  return checkSchema(schema.EditorEventSchema, value);
}
