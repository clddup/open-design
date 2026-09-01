import type { DesignDocument } from "./public-types.js";
import { PaintSchema } from "./appearance.js";
import { migrateFigmaComponentProperties } from "./component-properties.js";
import * as exportSettings from "./export-settings.js";
import { PathDataSchema } from "./path-schema.js";
import { checkSchema } from "./schema-check.js";
import * as styles from "./styles.js";
import { migrateAdvancedTextDecoration } from "./text-decoration.js";
import * as variables from "./variables.js";
import { migrateVariantSets } from "./variant-sets.js";
import * as versions from "./versions.js";

export type CurrentDesignDocumentParser = (
  value: unknown,
) => DesignDocument | null;

export function migrateDesignDocumentValue(
  value: unknown,
  parseCurrent: CurrentDesignDocumentParser,
): DesignDocument | null {
  const current = parseCurrent(value);
  if (current) return structuredClone(current);
  const schemaVersion =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as { schemaVersion?: unknown }).schemaVersion
      : undefined;
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (schemaVersion !== versions.DESIGN_SCHEMA_VERSION &&
      !versions.MIGRATABLE_DESIGN_SCHEMA_VERSIONS.includes(
        String(schemaVersion),
      ))
  ) {
    return null;
  }
  if (schemaVersion === versions.DESIGN_SCHEMA_VERSION) return null;
  try {
    const migrated = structuredClone(value) as Record<string, unknown>;
    migrated.schemaVersion = versions.DESIGN_SCHEMA_VERSION;
    migrated.libraryComponentsById ??= {};
    migrated.libraryVariantSetsById ??= {};
    migrated.libraryStylesById ??= {};
    migrated.libraryVariableCollectionsById ??= {};
    migrated.libraryVariablesById ??= {};
    migrated.imageAssetDerivationOrder ??= [];
    migrated.imageAssetDerivationsById ??= {};
    if (
      schemaVersion === versions.ADVANCED_VECTOR_CUT_DESIGN_SCHEMA_VERSION &&
      hasLegacyInstanceNodes(migrated)
    ) {
      return null;
    }
    if (
      schemaVersion === versions.LEGACY_DESIGN_SCHEMA_VERSION ||
      schemaVersion === versions.APPEARANCE_DESIGN_SCHEMA_VERSION
    ) {
      migratePathNodes(migrated, schemaVersion);
    }
    migrateImageNodes(migrated, String(schemaVersion));
    migrateTextNodes(migrated);
    migrateFigmaComponentProperties(migrated);
    migrateVariantSets(migrated);
    if (!variables.migrateFigmaVariables(migrated)) return null;
    styles.migrateSharedStyles(migrated);
    exportSettings.migrateExportSettings(migrated);
    return parseCurrent(migrated);
  } catch {
    return null;
  }
}

function hasLegacyInstanceNodes(document: Record<string, unknown>): boolean {
  const nodes = document.nodesById;
  if (!nodes || typeof nodes !== "object" || Array.isArray(nodes)) return false;
  return Object.values(nodes).some(
    (node) =>
      node !== null &&
      typeof node === "object" &&
      !Array.isArray(node) &&
      (node as { kind?: unknown }).kind === "instance",
  );
}

function migrateTextNodes(document: Record<string, unknown>): void {
  const nodes = document.nodesById;
  if (!nodes || typeof nodes !== "object" || Array.isArray(nodes)) return;
  for (const value of Object.values(nodes)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const node = value as Record<string, unknown>;
    if (node.kind !== "text") continue;
    const properties = node.properties;
    if (
      !properties ||
      typeof properties !== "object" ||
      Array.isArray(properties)
    ) {
      continue;
    }
    const textProperties = properties as Record<string, unknown>;
    textProperties.fontStyleName ??= null;
    textProperties.fontSlant ??= "normal";
    textProperties.textWrap ??= "character";
    if (textProperties.textOverflow === "ellipsis") {
      textProperties.textOverflow = "clip";
      textProperties.textTruncation = "ending";
    } else {
      textProperties.textOverflow ??= "visible";
      textProperties.textTruncation ??= "disabled";
    }
    textProperties.maxLines ??= null;
    textProperties.textResize ??= "fixed";
    textProperties.paragraphIndent ??= 0;
    textProperties.paragraphSpacing ??= 0;
    textProperties.listSpacing ??= 0;
    textProperties.hangingList ??= false;
    textProperties.textCase ??= "original";
    textProperties.textDecoration ??= "none";
    migrateAdvancedTextDecoration(textProperties, true);
    textProperties.runs ??= [];
    textProperties.paragraphRuns ??= [];
    if (Array.isArray(textProperties.runs)) {
      const merged: unknown[] = [];
      for (const value of textProperties.runs) {
        const run = isRecordValue(value) ? value : null;
        if (run && isRecordValue(run.style)) {
          migrateAdvancedTextDecoration(run.style, true);
        }
        const previous = merged.at(-1);
        if (
          run &&
          isRecordValue(previous) &&
          previous.end === run.start &&
          JSON.stringify(previous.style) === JSON.stringify(run.style)
        ) {
          previous.end = run.end;
        } else {
          merged.push(value);
        }
      }
      textProperties.runs = merged;
    }
    if (Array.isArray(textProperties.paragraphRuns)) {
      const merged: unknown[] = [];
      for (const value of textProperties.paragraphRuns) {
        const run = isRecordValue(value) ? value : null;
        if (run && isRecordValue(run.style)) {
          run.style.listOptions ??= { type: "none" };
          run.style.indentation ??= 0;
          run.style.listSpacing ??= textProperties.listSpacing;
        }
        const previous = merged.at(-1);
        if (
          run &&
          isRecordValue(previous) &&
          previous.end === run.start &&
          JSON.stringify(previous.style) === JSON.stringify(run.style)
        ) {
          previous.end = run.end;
        } else {
          merged.push(value);
        }
      }
      textProperties.paragraphRuns = merged;
    }
  }
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function migrateImageNodes(
  document: Record<string, unknown>,
  sourceSchemaVersion: string,
): void {
  const nodes = document.nodesById;
  if (!nodes || typeof nodes !== "object" || Array.isArray(nodes)) return;
  for (const value of Object.values(nodes)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const node = value as Record<string, unknown>;
    if (node.kind !== "image") continue;
    const properties =
      node.properties &&
      typeof node.properties === "object" &&
      !Array.isArray(node.properties)
        ? (node.properties as Record<string, unknown>)
        : null;
    if (!properties) continue;
    const legacyFit = properties.fit;
    if (
      legacyFit !== "fill" &&
      legacyFit !== "contain" &&
      legacyFit !== "cover"
    ) {
      continue;
    }
    properties.placement =
      legacyFit === "fill"
        ? { mode: "stretch" }
        : legacyFit === "contain"
          ? { mode: "fit" }
          : { mode: "fill", focalPoint: { x: 0.5, y: 0.5 } };
    delete properties.fit;
    const extensions =
      node.extensions &&
      typeof node.extensions === "object" &&
      !Array.isArray(node.extensions)
        ? (node.extensions as Record<string, unknown>)
        : {};
    extensions["dev.opendesign.image-placement.migration"] = {
      sourceSchemaVersion,
      legacyFit,
    };
    node.extensions = extensions;
  }
}

function migratePathNodes(
  document: Record<string, unknown>,
  sourceSchemaVersion: string,
): void {
  const nodes = document.nodesById;
  if (!nodes || typeof nodes !== "object" || Array.isArray(nodes)) return;
  for (const value of Object.values(nodes)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const node = value as Record<string, unknown>;
    if (node.kind !== "path" && node.kind !== "vector") continue;
    const legacy =
      node.properties &&
      typeof node.properties === "object" &&
      !Array.isArray(node.properties)
        ? (node.properties as Record<string, unknown>)
        : {};
    const path =
      typeof legacy.path === "string" &&
      checkSchema(PathDataSchema, legacy.path)
        ? legacy.path
        : "M 0 0";
    const extensions =
      node.extensions &&
      typeof node.extensions === "object" &&
      !Array.isArray(node.extensions)
        ? (node.extensions as Record<string, unknown>)
        : {};
    extensions["dev.opendesign.path.migration"] = {
      sourceSchemaVersion,
      originalProperties: legacy,
      usedPlaceholderPath: path !== legacy.path,
    };
    node.extensions = extensions;
    node.properties = {
      path,
      fills:
        Array.isArray(legacy.fills) &&
        legacy.fills.every((paint) => checkSchema(PaintSchema, paint))
          ? legacy.fills
          : [],
      strokes:
        Array.isArray(legacy.strokes) &&
        legacy.strokes.every((paint) => checkSchema(PaintSchema, paint))
          ? legacy.strokes
          : [],
      strokeWidth:
        typeof legacy.strokeWidth === "number" &&
        Number.isFinite(legacy.strokeWidth) &&
        legacy.strokeWidth >= 0
          ? legacy.strokeWidth
          : 0,
      ...(legacy.strokeAlign === "inside" ||
      legacy.strokeAlign === "center" ||
      legacy.strokeAlign === "outside"
        ? { strokeAlign: legacy.strokeAlign }
        : {}),
      ...(legacy.strokeCap === "none" ||
      legacy.strokeCap === "round" ||
      legacy.strokeCap === "square"
        ? { strokeCap: legacy.strokeCap }
        : {}),
      ...(legacy.strokeJoin === "miter" ||
      legacy.strokeJoin === "round" ||
      legacy.strokeJoin === "bevel"
        ? { strokeJoin: legacy.strokeJoin }
        : {}),
      ...(Array.isArray(legacy.dashPattern) &&
      legacy.dashPattern.every(
        (entry) =>
          typeof entry === "number" && Number.isFinite(entry) && entry >= 0,
      )
        ? { dashPattern: legacy.dashPattern }
        : {}),
      ...(legacy.fillRule === "nonzero" || legacy.fillRule === "evenodd"
        ? { fillRule: legacy.fillRule }
        : {}),
    };
  }
}
