import type {
  DesignDocument,
  DesignNode,
  SharedStyleDefinition,
  SharedStyleType,
  StyleReferenceTarget,
} from "@opendesign/design-contracts";
import {
  materializeTextRunStyles,
  textRunUsesAnyStyle,
} from "./text-run-style-projection.js";
import {
  materializeVectorRegionStyles,
  vectorRegionUsesAnyStyle,
} from "./vector-region-style-projection.js";

export const STYLE_SERVICE_VERSION = 3 as const;

export type StyleIssueCode =
  | "duplicate-key"
  | "duplicate-order-entry"
  | "incompatible-reference"
  | "map-id-mismatch"
  | "local-library-id-conflict"
  | "library-source-identity-mismatch"
  | "missing-order-entry"
  | "missing-style"
  | "order-type-mismatch"
  | "unknown-order-entry";

export interface StyleDocumentIssue {
  code: StyleIssueCode;
  message: string;
  path: string;
  nodeId?: string;
  styleId?: string;
}

export interface StyleProjectionResult {
  document: DesignDocument;
  issues: readonly StyleDocumentIssue[];
}

const REFERENCE_TYPES = {
  fillStyleId: "PAINT",
  strokeStyleId: "PAINT",
  effectStyleId: "EFFECT",
  textStyleId: "TEXT",
  gridStyleId: "GRID",
} as const satisfies Record<StyleReferenceTarget["field"], SharedStyleType>;

export function validateStyleDocument(
  document: DesignDocument,
): StyleDocumentIssue[] {
  const issues: StyleDocumentIssue[] = [];
  const keys = new Map<string, string>();
  const ordered = new Set<string>();
  for (const [styleId, style] of Object.entries(document.stylesById)) {
    if (document.libraryStylesById[styleId]) {
      issues.push(
        issue(
          "local-library-id-conflict",
          `/libraryStylesById/${pointer(styleId)}`,
          `Library Style ${styleId} conflicts with a local Style`,
          styleId,
        ),
      );
    }
    if (style.id !== styleId) {
      issues.push(
        issue(
          "map-id-mismatch",
          `/stylesById/${pointer(styleId)}/id`,
          `Style id ${style.id} must match map key ${styleId}`,
          styleId,
        ),
      );
    }
    const existing = keys.get(style.key);
    if (existing) {
      issues.push(
        issue(
          "duplicate-key",
          `/stylesById/${pointer(styleId)}/key`,
          `Style key ${style.key} is already used by ${existing}`,
          styleId,
        ),
      );
    } else keys.set(style.key, styleId);
  }
  for (const [styleId, source] of Object.entries(document.libraryStylesById)) {
    const path = `/libraryStylesById/${pointer(styleId)}`;
    if (source.style.id !== styleId) {
      issues.push(
        issue(
          "map-id-mismatch",
          `${path}/style/id`,
          `Library Style id ${source.style.id} must match map key ${styleId}`,
          styleId,
        ),
      );
    }
    if (source.source.sourceStyleId !== styleId) {
      issues.push(
        issue(
          "library-source-identity-mismatch",
          `${path}/source/sourceStyleId`,
          `Library Style source id ${source.source.sourceStyleId} must match map key ${styleId}`,
          styleId,
        ),
      );
    }
    const existing = keys.get(source.style.key);
    if (existing) {
      issues.push(
        issue(
          "duplicate-key",
          `${path}/style/key`,
          `Style key ${source.style.key} is already used by ${existing}`,
          styleId,
        ),
      );
    } else keys.set(source.style.key, styleId);
  }
  for (const styleType of Object.keys(
    document.styleOrderByType,
  ) as SharedStyleType[]) {
    const local = new Set<string>();
    document.styleOrderByType[styleType].forEach((styleId, index) => {
      const path = `/styleOrderByType/${styleType}/${index}`;
      if (local.has(styleId) || ordered.has(styleId)) {
        issues.push(
          issue(
            "duplicate-order-entry",
            path,
            `Style ${styleId} appears more than once in style order`,
            styleId,
          ),
        );
      }
      local.add(styleId);
      ordered.add(styleId);
      const style = document.stylesById[styleId];
      if (!style) {
        issues.push(
          issue(
            "unknown-order-entry",
            path,
            `Style ${styleId} does not exist`,
            styleId,
          ),
        );
      } else if (style.styleType !== styleType) {
        issues.push(
          issue(
            "order-type-mismatch",
            path,
            `Style ${styleId} is ${style.styleType}, not ${styleType}`,
            styleId,
          ),
        );
      }
    });
  }
  for (const styleId of Object.keys(document.stylesById)) {
    if (!ordered.has(styleId)) {
      issues.push(
        issue(
          "missing-order-entry",
          `/stylesById/${pointer(styleId)}`,
          `Style ${styleId} is missing from style order`,
          styleId,
        ),
      );
    }
  }
  for (const node of Object.values(document.nodesById)) {
    for (const field of Object.keys(
      REFERENCE_TYPES,
    ) as StyleReferenceTarget["field"][]) {
      const styleId = node[field];
      if (!styleId) continue;
      const path = `/nodesById/${pointer(node.id)}/${field}`;
      const style = styleDefinition(document, styleId);
      if (!style) {
        issues.push({
          ...issue(
            "missing-style",
            path,
            `Style ${styleId} does not exist`,
            styleId,
          ),
          nodeId: node.id,
        });
      } else if (!styleCanApply(node, field, style)) {
        issues.push({
          ...issue(
            "incompatible-reference",
            path,
            `${field} requires a compatible ${REFERENCE_TYPES[field]} style`,
            styleId,
          ),
          nodeId: node.id,
        });
      }
    }
    if (
      (node.kind === "path" || node.kind === "vector") &&
      "network" in node.properties
    ) {
      for (const [
        regionIndex,
        region,
      ] of node.properties.network.regions.entries()) {
        const styleId = region.fillStyleId;
        if (!styleId) continue;
        const path = `/nodesById/${pointer(node.id)}/properties/network/regions/${regionIndex}/fillStyleId`;
        const style = styleDefinition(document, styleId);
        if (!style || style.styleType !== "PAINT") {
          issues.push({
            ...issue(
              style ? "incompatible-reference" : "missing-style",
              path,
              style
                ? `Vector region fillStyleId cannot consume ${style.styleType} style ${styleId}`
                : `Style ${styleId} does not exist`,
              styleId,
            ),
            nodeId: node.id,
          });
        }
      }
    }
  }
  return issues;
}

export function materializeSharedStyles(
  document: DesignDocument,
): StyleProjectionResult {
  const fields = Object.keys(
    REFERENCE_TYPES,
  ) as StyleReferenceTarget["field"][];
  if (
    !Object.values(document.nodesById).some(
      (node) =>
        fields.some((field) => node[field] !== undefined) ||
        vectorRegionUsesAnyStyle(node) ||
        textRunUsesAnyStyle(node),
    )
  ) {
    return { document, issues: [] };
  }
  const nodesById = { ...document.nodesById };
  const issues: StyleDocumentIssue[] = [];
  for (const source of Object.values(document.nodesById)) {
    if (
      !fields.some((field) => source[field] !== undefined) &&
      !vectorRegionUsesAnyStyle(source) &&
      !textRunUsesAnyStyle(source)
    ) {
      continue;
    }
    const node = structuredClone(source);
    nodesById[node.id] = node;
    for (const field of fields) {
      const styleId = node[field];
      if (!styleId) continue;
      const style = styleDefinition(document, styleId);
      if (!style || !styleCanApply(node, field, style)) {
        const code = style ? "incompatible-reference" : "missing-style";
        issues.push({
          ...issue(
            code,
            `/nodesById/${pointer(node.id)}/${field}`,
            style
              ? `${field} cannot consume ${style.styleType} style ${styleId}`
              : `Style ${styleId} does not exist`,
            styleId,
          ),
          nodeId: node.id,
        });
        continue;
      }
      applyStyle(node, field, style);
    }
    issues.push(
      ...materializeVectorRegionStyles(node, (styleId) =>
        styleDefinition(document, styleId),
      ),
    );
    issues.push(
      ...materializeTextRunStyles(node, (styleId) =>
        styleDefinition(document, styleId),
      ),
    );
  }
  return { document: { ...document, nodesById }, issues };
}

export function materializeNodeStyle(
  document: DesignDocument,
  nodeId: string,
): { node: DesignNode | undefined; issues: readonly StyleDocumentIssue[] } {
  const projected = materializeSharedStyles(document);
  return {
    node: projected.document.nodesById[nodeId],
    issues: projected.issues.filter((entry) => entry.nodeId === nodeId),
  };
}

export function styleConsumers(
  document: DesignDocument,
  styleId: string,
): StyleReferenceTarget[] {
  const consumers: StyleReferenceTarget[] = [];
  for (const node of Object.values(document.nodesById)) {
    for (const field of Object.keys(
      REFERENCE_TYPES,
    ) as StyleReferenceTarget["field"][]) {
      if (node[field] === styleId) consumers.push({ nodeId: node.id, field });
    }
    if (
      (node.kind === "path" || node.kind === "vector") &&
      "network" in node.properties
    ) {
      for (const region of node.properties.network.regions) {
        if (region.fillStyleId === styleId) {
          consumers.push({
            nodeId: node.id,
            regionId: region.id,
            field: "fillStyleId",
          });
        }
      }
    }
  }
  return consumers;
}

export function styleDefinition(
  document: DesignDocument,
  styleId: string,
): SharedStyleDefinition | undefined {
  return (
    document.stylesById[styleId] ?? document.libraryStylesById[styleId]?.style
  );
}

export function styleDefinitions(
  document: DesignDocument,
): SharedStyleDefinition[] {
  return [
    ...Object.values(document.stylesById),
    ...Object.values(document.libraryStylesById).map((source) => source.style),
  ];
}

export function styleIsReferenced(
  document: DesignDocument,
  styleId: string,
): boolean {
  if (
    Object.values(document.nodesById).some((node) =>
      nodeUsesStyle(node, styleId),
    )
  ) {
    return true;
  }
  return Object.values(document.libraryComponentsById).some((source) =>
    Object.values(source.nodesById).some((node) =>
      nodeUsesStyle(node, styleId),
    ),
  );
}

export function styleTypeForReference(
  field: StyleReferenceTarget["field"],
): SharedStyleType {
  return REFERENCE_TYPES[field];
}

export function styleCanApply(
  node: DesignNode,
  field: StyleReferenceTarget["field"],
  style: SharedStyleDefinition,
): boolean {
  if (style.styleType !== REFERENCE_TYPES[field]) return false;
  if (field === "effectStyleId") return true;
  if (field === "textStyleId") return node.kind === "text";
  if (field === "gridStyleId") return node.kind === "frame";
  return hasPaints(node);
}

function applyStyle(
  node: DesignNode,
  field: StyleReferenceTarget["field"],
  style: SharedStyleDefinition,
): void {
  if (field === "effectStyleId" && style.styleType === "EFFECT") {
    node.effects = structuredClone(style.effects);
  } else if (
    field === "textStyleId" &&
    style.styleType === "TEXT" &&
    node.kind === "text"
  ) {
    Object.assign(node.properties, structuredClone(style.textStyle));
  } else if (
    field === "gridStyleId" &&
    style.styleType === "GRID" &&
    node.kind === "frame"
  ) {
    node.properties.layoutGuides = structuredClone(style.layoutGuides);
  } else if (style.styleType === "PAINT" && hasPaints(node)) {
    const property = field === "fillStyleId" ? "fills" : "strokes";
    const fallback = node.properties[property];
    const paints = structuredClone(style.paints);
    for (const [index, paint] of paints.entries()) {
      const fallbackPaint = fallback[index];
      if (
        paint.type === "solid" &&
        fallbackPaint?.type === "solid" &&
        fallbackPaint.boundVariables
      ) {
        paint.boundVariables = structuredClone(fallbackPaint.boundVariables);
      }
    }
    node.properties[property] = paints;
  }
}

function hasPaints(node: DesignNode): node is Extract<
  DesignNode,
  {
    kind:
      | "frame"
      | "slot"
      | "boolean"
      | "rectangle"
      | "ellipse"
      | "line"
      | "polygon"
      | "star"
      | "text"
      | "vector"
      | "path";
  }
> {
  return "fills" in node.properties && "strokes" in node.properties;
}

function nodeUsesStyle(node: DesignNode, styleId: string): boolean {
  if (
    (Object.keys(REFERENCE_TYPES) as StyleReferenceTarget["field"][]).some(
      (field) => node[field] === styleId,
    )
  ) {
    return true;
  }
  if (
    (node.kind === "path" || node.kind === "vector") &&
    "network" in node.properties &&
    node.properties.network.regions.some(
      (region) => region.fillStyleId === styleId,
    )
  ) {
    return true;
  }
  return (
    node.kind === "text" &&
    (node.properties.runs ?? []).some(
      (run) =>
        run.style.textStyleId === styleId || run.style.fillStyleId === styleId,
    )
  );
}

function issue(
  code: StyleIssueCode,
  path: string,
  message: string,
  styleId?: string,
): StyleDocumentIssue {
  return { code, path, message, ...(styleId ? { styleId } : {}) };
}

function pointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}
