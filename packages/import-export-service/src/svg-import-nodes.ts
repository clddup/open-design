import {
  normalizeLineEndpoints,
  type DesignNode,
  type Rect,
  type Transform,
} from "@opendesign/design-contracts";
import type { VectorGeometryProvider } from "@opendesign/geometry-service/vector-path";
import {
  normalizeVectorNetwork,
  serializeVectorRegion,
} from "@opendesign/geometry-service/editable-vector";
import { compose, translate } from "transformation-matrix";
import {
  collectSvgGradientDefinitions,
  importSvgShapeProperties,
} from "./svg-appearance.js";
import {
  collectSvgFilterDefinitions,
  readSvgFilterEffects,
} from "./svg-filter-effects.js";
import {
  collectSvgMaskDefinitions,
  controlledSvgClippingSourcesMatch,
  parseLocalSvgUrlReference,
  readSerializedSvgMaskMode,
  readVisibleSvgMaskSourceReference,
  resolveControlledSvgMaskRun,
  resolveStandardSvgMaskReference,
  validateSvgFrameClipDefinition,
  type SvgMaskReference,
} from "./svg-mask-clip.js";
import {
  createSvgIssue,
  reportUnsupportedSvgElementAttributes,
  svgIssuesHaveErrors,
  type SvgInterchangeIssue,
} from "./svg-issues.js";
import {
  collectSvgLineEndpointDefinitions,
  readSvgLineEndpoints,
  type SvgLineEndpointDefinition,
} from "./svg-line-endpoints.js";
import { readSvgRegularShape } from "./svg-regular-shapes.js";
import { readSvgText, svgTextShapeMatches } from "./svg-text.js";
import { readSvgEditableVector } from "./svg-editable-vector.js";
import { SVG_IMPORT_MAX_DEPTH, SVG_IMPORT_MAX_NODES } from "./svg-parse.js";
import {
  DEFAULT_IMPORTED_SVG_STYLE,
  importedSvgGroupBounds,
  isPositiveSvgLength,
  readImportedSvgStyle,
  readSvgElementTransform,
  readSvgLength,
  readSvgOpacity,
  readSvgStyleOrAttribute,
  rebaseImportedSvgChildren,
  transformFromSvgMatrix,
  transformToSvgMatrix,
  type ImportedSvgStyle,
} from "./svg-normalize.js";
import { formatSvgNumber, sanitizeSvgXmlId } from "./svg-serialize.js";

const MAX_SVG_DEPTH = SVG_IMPORT_MAX_DEPTH;
const MAX_IMPORTED_NODES = SVG_IMPORT_MAX_NODES;

interface ImportContext {
  activeMaskReferences: Set<string>;
  filterDefinitions: ReadonlyMap<string, Element>;
  geometry: VectorGeometryProvider;
  gradientDefinitions: ReadonlyMap<string, Element>;
  idPrefix: string;
  issues: SvgInterchangeIssue[];
  maskDefinitions: ReadonlyMap<string, Element>;
  markerDefinitions: ReadonlyMap<string, SvgLineEndpointDefinition>;
  nodeSequence: number;
  nodes: DesignNode[];
  rootStyle: ImportedSvgStyle;
  version: number;
}

type ImportedNodeBase = Pick<
  Extract<DesignNode, { kind: "group" }>,
  | "blendMode"
  | "childIds"
  | "effects"
  | "exportSettings"
  | "extensions"
  | "id"
  | "locked"
  | "maskMode"
  | "name"
  | "opacity"
  | "parentId"
  | "visible"
>;

export type SvgNodeImportResult =
  | {
      ok: true;
      rootNodeId: string;
      nodes: readonly DesignNode[];
      sourceViewport: Rect;
      issues: readonly SvgInterchangeIssue[];
    }
  | { ok: false; issues: readonly SvgInterchangeIssue[] };

export function importSvgNodes(input: {
  geometry: VectorGeometryProvider;
  idPrefix: string;
  name?: string;
  root: Element;
  sourceViewport: Rect;
  version: number;
}): SvgNodeImportResult {
  const issues: SvgInterchangeIssue[] = [];
  const rootStyle = readImportedSvgStyle(
    input.root,
    DEFAULT_IMPORTED_SVG_STYLE,
    issues,
  );
  for (const property of ["mask", "clip-path"] as const) {
    const value = readSvgStyleOrAttribute(input.root, property);
    if (value && value.trim().toLowerCase() !== "none") {
      issues.push(
        createSvgIssue(
          "mask-omitted",
          "error",
          `SVG root-level ${property} requires a later viewport compositing slice`,
          { sourceElement: input.root.localName },
        ),
      );
    }
  }
  const maskDefinitions = collectSvgMaskDefinitions(input.root, issues);
  const context: ImportContext = {
    activeMaskReferences: new Set(),
    filterDefinitions: collectSvgFilterDefinitions(input.root),
    geometry: input.geometry,
    gradientDefinitions: collectSvgGradientDefinitions(input.root),
    idPrefix: input.idPrefix,
    issues,
    maskDefinitions,
    markerDefinitions: collectSvgLineEndpointDefinitions(input.root, issues),
    nodeSequence: 0,
    nodes: [],
    rootStyle,
    version: input.version,
  };
  const rootNodeId = nextImportedNodeId(context, "root");
  const rootEffects = readSvgFilterEffects({
    definitions: context.filterDefinitions,
    element: input.root,
    nodeId: rootNodeId,
  });
  issues.push(...rootEffects.issues);
  const childIds = importContainerChildren(
    context,
    elementChildren(input.root),
    rootNodeId,
    rootStyle,
    1,
  );
  if (svgIssuesHaveErrors(issues)) return { ok: false, issues };
  if (childIds.length === 0) {
    return {
      ok: false,
      issues: [
        createSvgIssue(
          "invalid-root",
          "error",
          "SVG import did not contain any supported editable graphics",
        ),
      ],
    };
  }

  const viewportOffset = translate(
    -input.sourceViewport.x,
    -input.sourceViewport.y,
  );
  for (const childId of childIds) {
    const node = context.nodes.find((candidate) => candidate.id === childId);
    if (node) {
      node.transform = transformFromSvgMatrix(
        compose(viewportOffset, transformToSvgMatrix(node.transform)),
      );
    }
  }
  const rootNode: DesignNode = {
    id: rootNodeId,
    kind: "group",
    name: input.name?.trim() || readSvgName(input.root) || "Imported SVG",
    parentId: null,
    childIds,
    visible:
      input.root.getAttribute("display") !== "none" &&
      input.root.getAttribute("visibility") !== "hidden",
    locked: false,
    transform: [1, 0, 0, 1, 0, 0],
    size: {
      width: input.sourceViewport.width,
      height: input.sourceViewport.height,
    },
    opacity: readSvgOpacity(input.root.getAttribute("opacity"), 1),
    exportSettings: [],
    ...(rootEffects.effects.length === 0
      ? {}
      : { effects: [...rootEffects.effects] }),
    properties: {},
    extensions: {
      svgImport: {
        version: input.version,
        viewBox: { ...input.sourceViewport },
      },
    },
  };
  return {
    ok: true,
    rootNodeId,
    nodes: [rootNode, ...context.nodes],
    sourceViewport: input.sourceViewport,
    issues,
  };
}

function importContainerChildren(
  context: ImportContext,
  children: readonly Element[],
  parentId: string,
  inheritedStyle: ImportedSvgStyle,
  depth: number,
): string[] {
  const childIds: string[] = [];
  const visibleMaskSources = new Map<
    string,
    { element: Element; nodeId: string }
  >();
  const consumedMaskReferences = new Set<string>();

  for (const child of children) {
    if (child.getAttribute("data-opendesign-mask-run") === "true") {
      const reference = resolveControlledSvgMaskRun(
        child,
        context.maskDefinitions,
        context.issues,
      );
      if (!reference) continue;
      if (consumedMaskReferences.has(reference.id)) {
        context.issues.push(
          createSvgIssue(
            "mask-omitted",
            "error",
            `SVG mask run #${reference.id} is repeated in one container`,
            { sourceElement: child.localName },
          ),
        );
        continue;
      }
      consumedMaskReferences.add(reference.id);

      let sourceId: string | null;
      if (reference.mode === "clipping") {
        const visibleSource = visibleMaskSources.get(reference.id);
        sourceId = visibleSource?.nodeId ?? null;
        if (!sourceId || !visibleSource) {
          context.issues.push(
            createSvgIssue(
              "mask-omitted",
              "error",
              `SVG clipping mask run #${reference.id} is missing its visible sibling source`,
              { sourceElement: child.localName },
            ),
          );
          continue;
        }
        if (
          !controlledSvgClippingSourcesMatch(
            visibleSource.element,
            reference.definition,
          )
        ) {
          context.issues.push(
            createSvgIssue(
              "mask-omitted",
              "error",
              `SVG clipping mask definition #${reference.id} does not match its visible source`,
              { nodeId: sourceId, sourceElement: child.localName },
            ),
          );
          continue;
        }
        visibleMaskSources.delete(reference.id);
      } else {
        sourceId = importMaskDefinitionSource(
          context,
          reference,
          parentId,
          depth,
        );
        if (sourceId) childIds.push(sourceId);
      }

      for (const maskedElement of elementChildren(child)) {
        const maskedId = importElement(
          context,
          maskedElement,
          parentId,
          inheritedStyle,
          depth,
        );
        if (maskedId) childIds.push(maskedId);
      }
      continue;
    }

    const sourceReference = readVisibleSvgMaskSourceReference(
      child,
      context.maskDefinitions,
      context.issues,
    );
    const childId = importElement(
      context,
      child,
      parentId,
      inheritedStyle,
      depth,
    );
    if (!childId) continue;
    childIds.push(childId);
    if (sourceReference) {
      if (visibleMaskSources.has(sourceReference.id)) {
        context.issues.push(
          createSvgIssue(
            "mask-omitted",
            "error",
            `SVG clipping mask #${sourceReference.id} has multiple visible sources`,
            { nodeId: childId, sourceElement: child.localName },
          ),
        );
      } else {
        visibleMaskSources.set(sourceReference.id, {
          element: child,
          nodeId: childId,
        });
      }
    }
  }

  for (const [referenceId, source] of visibleMaskSources) {
    context.issues.push(
      createSvgIssue(
        "mask-omitted",
        "error",
        `SVG clipping mask source #${referenceId} is not followed by its mask run`,
        { nodeId: source.nodeId },
      ),
    );
  }
  return childIds;
}

function importMaskedElement(
  context: ImportContext,
  element: Element,
  parentId: string,
  inheritedStyle: ImportedSvgStyle,
  depth: number,
  reference: SvgMaskReference,
): string | null {
  const checkpoint = context.nodes.length;
  const groupId = nextImportedNodeId(context, "mask-group");
  const sourceId = importMaskDefinitionSource(
    context,
    reference,
    groupId,
    depth + 1,
  );
  const source = sourceId
    ? context.nodes.find((node) => node.id === sourceId)
    : undefined;
  if (source) {
    source.transform = transformFromSvgMatrix(
      compose(
        transformToSvgMatrix(readSvgElementTransform(element, context.issues)),
        transformToSvgMatrix(source.transform),
      ),
    );
  }
  const targetId = importElement(
    context,
    element,
    groupId,
    inheritedStyle,
    depth + 1,
    { ignoreMaskReference: true },
  );
  const exceedsNodeBudget = context.nodes.length >= MAX_IMPORTED_NODES;
  if (!sourceId || !targetId || exceedsNodeBudget) {
    context.nodes.splice(checkpoint);
    if (exceedsNodeBudget) {
      context.issues.push(
        createSvgIssue(
          "element-limit",
          "error",
          `SVG import exceeds ${MAX_IMPORTED_NODES} editable nodes`,
          { sourceElement: element.localName },
        ),
      );
    }
    return null;
  }
  const childIds = [sourceId, targetId];
  const bounds = importedSvgGroupBounds(context.nodes, childIds);
  rebaseImportedSvgChildren(context.nodes, childIds, bounds.x, bounds.y);
  const group: DesignNode = {
    id: groupId,
    kind: "group",
    name: `${readSvgName(element) || capitalize(element.localName)} Mask`,
    parentId,
    childIds,
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, bounds.x, bounds.y],
    size: { width: bounds.width, height: bounds.height },
    opacity: 1,
    exportSettings: [],
    properties: {},
    extensions: {
      svgImport: {
        version: context.version,
        sourceElement: "mask-wrapper",
        maskReference: reference.id,
      },
    },
  };
  context.nodes.push(group);
  return groupId;
}

function importMaskDefinitionSource(
  context: ImportContext,
  reference: SvgMaskReference,
  parentId: string,
  depth: number,
): string | null {
  if (context.activeMaskReferences.has(reference.id)) {
    context.issues.push(
      createSvgIssue(
        "mask-omitted",
        "error",
        `SVG mask reference cycle detected at #${reference.id}`,
        { sourceElement: reference.definition.localName },
      ),
    );
    return null;
  }
  context.activeMaskReferences.add(reference.id);
  try {
    const definitionStyle = readImportedSvgStyle(
      reference.definition,
      context.rootStyle,
      context.issues,
    );
    const definitionTransform = readSvgElementTransform(
      reference.definition,
      context.issues,
    );
    const sourceElements = elementChildren(reference.definition).filter(
      (child) =>
        !["title", "desc", "metadata", "defs"].includes(
          child.localName.toLowerCase(),
        ),
    );
    if (sourceElements.length === 0) {
      context.issues.push(
        createSvgIssue(
          "mask-omitted",
          "error",
          `SVG mask definition #${reference.id} contains no editable graphics`,
          { sourceElement: reference.definition.localName },
        ),
      );
      return null;
    }
    if (sourceElements.length === 1) {
      const sourceId = importElement(
        context,
        sourceElements[0]!,
        parentId,
        definitionStyle,
        depth,
      );
      const source = sourceId
        ? context.nodes.find((node) => node.id === sourceId)
        : undefined;
      if (!source) return null;
      source.maskMode = reference.mode;
      if (
        reference.mode === "outline" &&
        reference.definition.getAttribute("data-opendesign-mask-version") !==
          "1"
      ) {
        source.opacity = 1;
      }
      source.transform = transformFromSvgMatrix(
        compose(
          transformToSvgMatrix(definitionTransform),
          transformToSvgMatrix(source.transform),
        ),
      );
      return sourceId;
    }

    if (context.nodes.length >= MAX_IMPORTED_NODES) {
      context.issues.push(
        createSvgIssue(
          "element-limit",
          "error",
          `SVG import exceeds ${MAX_IMPORTED_NODES} editable nodes`,
          { sourceElement: reference.definition.localName },
        ),
      );
      return null;
    }
    const groupId = nextImportedNodeId(context, "mask-source");
    const checkpoint = context.nodes.length;
    const childIds = importContainerChildren(
      context,
      sourceElements,
      groupId,
      definitionStyle,
      depth + 1,
    );
    const exceedsNodeBudget = context.nodes.length >= MAX_IMPORTED_NODES;
    if (childIds.length === 0 || exceedsNodeBudget) {
      context.nodes.splice(checkpoint);
      if (exceedsNodeBudget) {
        context.issues.push(
          createSvgIssue(
            "element-limit",
            "error",
            `SVG import exceeds ${MAX_IMPORTED_NODES} editable nodes`,
            { sourceElement: reference.definition.localName },
          ),
        );
      } else {
        context.issues.push(
          createSvgIssue(
            "mask-omitted",
            "error",
            `SVG mask definition #${reference.id} contains no supported source layers`,
            { sourceElement: reference.definition.localName },
          ),
        );
      }
      return null;
    }
    const bounds = importedSvgGroupBounds(context.nodes, childIds);
    rebaseImportedSvgChildren(context.nodes, childIds, bounds.x, bounds.y);
    const group: DesignNode = {
      id: groupId,
      kind: "group",
      name: readSvgName(reference.definition) || "Mask Source",
      parentId,
      childIds,
      visible: true,
      locked: false,
      transform: transformFromSvgMatrix(
        compose(
          transformToSvgMatrix(definitionTransform),
          translate(bounds.x, bounds.y),
        ),
      ),
      size: { width: bounds.width, height: bounds.height },
      opacity: 1,
      exportSettings: [],
      maskMode: reference.mode,
      properties: {},
      extensions: {
        svgImport: {
          version: context.version,
          sourceElement: reference.definition.localName.toLowerCase(),
          sourceId: reference.id,
        },
      },
    };
    context.nodes.push(group);
    return groupId;
  } finally {
    context.activeMaskReferences.delete(reference.id);
  }
}

function importElement(
  context: ImportContext,
  element: Element,
  parentId: string,
  inheritedStyle: ImportedSvgStyle,
  depth: number,
  options: { ignoreMaskReference?: boolean } = {},
): string | null {
  const tag = element.localName.toLowerCase();
  if (
    tag === "defs" ||
    tag === "title" ||
    tag === "desc" ||
    tag === "metadata"
  ) {
    return null;
  }
  if (depth > MAX_SVG_DEPTH) {
    context.issues.push(
      createSvgIssue(
        "depth-limit",
        "error",
        `SVG import exceeds ${MAX_SVG_DEPTH} nested levels`,
        { sourceElement: tag },
      ),
    );
    return null;
  }
  if (context.nodes.length >= MAX_IMPORTED_NODES) {
    context.issues.push(
      createSvgIssue(
        "element-limit",
        "error",
        `SVG import exceeds ${MAX_IMPORTED_NODES} editable nodes`,
        { sourceElement: tag },
      ),
    );
    return null;
  }
  if (tag === "script" || tag === "foreignobject" || tag === "use") {
    context.issues.push(
      createSvgIssue(
        tag === "use" ? "external-reference" : "unsupported-element",
        "error",
        `SVG <${tag}> is not accepted by the editable import boundary`,
        { sourceElement: tag },
      ),
    );
    return null;
  }
  if (tag === "style") {
    context.issues.push(
      createSvgIssue(
        "unsupported-css",
        "error",
        "SVG stylesheets are not accepted; use presentation attributes or inline style",
        { sourceElement: tag },
      ),
    );
    return null;
  }
  if (tag === "image" || tag === "clippath" || tag === "mask") {
    context.issues.push(
      createSvgIssue(
        "unsupported-element",
        "error",
        `SVG <${tag}> requires a later typed import slice`,
        { sourceElement: tag },
      ),
    );
    return null;
  }

  if (!options.ignoreMaskReference) {
    const maskReference = resolveStandardSvgMaskReference(
      element,
      context.maskDefinitions,
      context.issues,
    );
    if (maskReference === null) return null;
    if (maskReference) {
      return importMaskedElement(
        context,
        element,
        parentId,
        inheritedStyle,
        depth,
        maskReference,
      );
    }
  }

  const localStyle = readImportedSvgStyle(
    element,
    inheritedStyle,
    context.issues,
  );
  const nodeId = nextImportedNodeId(context, tag);
  const filterEffects = readSvgFilterEffects({
    definitions: context.filterDefinitions,
    element,
    nodeId,
  });
  context.issues.push(...filterEffects.issues);
  reportUnsupportedSvgElementAttributes(element, context.issues);
  const transform = readSvgElementTransform(element, context.issues);
  const common: ImportedNodeBase = {
    id: nodeId,
    name: readSvgName(element) || `${capitalize(tag)} ${context.nodeSequence}`,
    parentId,
    childIds: [] as string[],
    visible:
      element.getAttribute("display") !== "none" &&
      element.getAttribute("visibility") !== "hidden",
    locked: false,
    opacity: readSvgOpacity(element.getAttribute("opacity"), 1),
    exportSettings: [],
    ...(filterEffects.effects.length === 0
      ? {}
      : { effects: [...filterEffects.effects] }),
    ...readSerializedSvgMaskMode(element),
    extensions: {
      svgImport: {
        version: context.version,
        sourceElement: tag,
        ...(element.getAttribute("id")
          ? { sourceId: element.getAttribute("id") }
          : {}),
      },
    },
  };

  const regularShape = readSvgRegularShape(element);
  if (regularShape.status === "invalid") {
    context.issues.push(
      createSvgIssue(
        "regular-shape-fidelity-unsupported",
        "error",
        regularShape.message,
        { nodeId, sourceElement: tag },
      ),
    );
    return null;
  }

  if (tag === "g") {
    if (
      element.getAttribute("data-opendesign-vector-region-container") === "true"
    ) {
      return importEditableVectorRegionContainer(
        context,
        element,
        nodeId,
        common,
        localStyle,
        transform,
      );
    }
    if (element.getAttribute("data-opendesign-kind") === "frame") {
      return importFrameElement(
        context,
        element,
        nodeId,
        common,
        localStyle,
        transform,
        depth,
      );
    }
    const childIds = importContainerChildren(
      context,
      elementChildren(element),
      nodeId,
      localStyle,
      depth + 1,
    );
    if (childIds.length === 0) return null;
    const bounds = importedSvgGroupBounds(context.nodes, childIds);
    rebaseImportedSvgChildren(context.nodes, childIds, bounds.x, bounds.y);
    const node: DesignNode = {
      ...common,
      kind: "group",
      childIds,
      transform: transformFromSvgMatrix(
        compose(transformToSvgMatrix(transform), translate(bounds.x, bounds.y)),
      ),
      size: { width: bounds.width, height: bounds.height },
      properties: {},
    };
    context.nodes.push(node);
    return nodeId;
  }

  if (tag === "text") {
    const serializedText = readSvgText(element);
    if (serializedText.status === "absent") {
      context.issues.push(
        createSvgIssue(
          "unsupported-element",
          "error",
          "Ordinary SVG <text> requires deterministic font and text-box semantics before editable import",
          { nodeId, sourceElement: tag },
        ),
      );
      return null;
    }
    if (serializedText.status === "invalid") {
      context.issues.push(
        createSvgIssue(
          "text-fidelity-unsupported",
          "error",
          serializedText.message,
          {
            nodeId,
            sourceElement: tag,
          },
        ),
      );
      return null;
    }
    const shape = importSvgShapeProperties(
      context,
      element,
      localStyle,
      nodeId,
    );
    if (!shape) return null;
    if (!svgTextShapeMatches(serializedText.value.properties, shape)) {
      context.issues.push(
        createSvgIssue(
          "text-fidelity-unsupported",
          "error",
          "OpenDesign text metadata does not match the rendered SVG paint or stroke",
          { nodeId, sourceElement: tag },
        ),
      );
      return null;
    }
    const node: DesignNode = {
      ...common,
      kind: "text",
      transform,
      size: {
        width: serializedText.value.width,
        height: serializedText.value.height,
      },
      properties: serializedText.value.properties,
    };
    context.nodes.push(node);
    return nodeId;
  }

  const properties = importSvgShapeProperties(
    context,
    element,
    localStyle,
    nodeId,
  );
  if (!properties) return null;

  if (regularShape.status === "valid") {
    const semantic = regularShape.value;
    const node: DesignNode =
      semantic.kind === "polygon"
        ? {
            ...common,
            kind: "polygon",
            transform,
            size: { width: semantic.width, height: semantic.height },
            properties: {
              ...properties,
              pointCount: semantic.pointCount,
              cornerRadius: semantic.cornerRadius,
              cornerSmoothing: semantic.cornerSmoothing,
            },
          }
        : {
            ...common,
            kind: "star",
            transform,
            size: { width: semantic.width, height: semantic.height },
            properties: {
              ...properties,
              pointCount: semantic.pointCount,
              innerRadius: semantic.innerRadius,
              cornerRadius: semantic.cornerRadius,
              cornerSmoothing: semantic.cornerSmoothing,
            },
          };
    context.nodes.push(node);
    return nodeId;
  }

  if (tag === "rect") {
    const x = readSvgLength(element, "x", 0, context.issues);
    const y = readSvgLength(element, "y", 0, context.issues);
    const width = readSvgLength(element, "width", null, context.issues);
    const height = readSvgLength(element, "height", null, context.issues);
    if (
      x === null ||
      y === null ||
      !isPositiveSvgLength(width) ||
      !isPositiveSvgLength(height)
    ) {
      context.issues.push(
        createSvgIssue(
          "invalid-dimension",
          "error",
          "SVG <rect> requires finite positive width and height",
          { sourceElement: tag },
        ),
      );
      return null;
    }
    const radius = readSvgLength(element, "rx", 0, context.issues);
    const node: DesignNode = {
      ...common,
      kind: "rectangle",
      transform: transformFromSvgMatrix(
        compose(transformToSvgMatrix(transform), translate(x, y)),
      ),
      size: { width, height },
      properties: {
        ...properties,
        cornerRadius: Math.max(0, radius ?? 0),
      },
    };
    context.nodes.push(node);
    return nodeId;
  }

  if (tag === "circle" || tag === "ellipse") {
    const cx = readSvgLength(element, "cx", 0, context.issues);
    const cy = readSvgLength(element, "cy", 0, context.issues);
    const rx =
      tag === "circle"
        ? readSvgLength(element, "r", null, context.issues)
        : readSvgLength(element, "rx", null, context.issues);
    const ry =
      tag === "circle"
        ? rx
        : readSvgLength(element, "ry", null, context.issues);
    if (
      cx === null ||
      cy === null ||
      !isPositiveSvgLength(rx) ||
      !isPositiveSvgLength(ry)
    ) {
      context.issues.push(
        createSvgIssue(
          "invalid-dimension",
          "error",
          `SVG <${tag}> requires finite positive radii`,
          { sourceElement: tag },
        ),
      );
      return null;
    }
    const node: DesignNode = {
      ...common,
      kind: "ellipse",
      transform: transformFromSvgMatrix(
        compose(transformToSvgMatrix(transform), translate(cx - rx, cy - ry)),
      ),
      size: { width: rx * 2, height: ry * 2 },
      properties,
    };
    context.nodes.push(node);
    return nodeId;
  }

  if (tag === "line") {
    const x1 = readSvgLength(element, "x1", 0, context.issues);
    const y1 = readSvgLength(element, "y1", 0, context.issues);
    const x2 = readSvgLength(element, "x2", 0, context.issues);
    const y2 = readSvgLength(element, "y2", 0, context.issues);
    if ([x1, y1, x2, y2].some((value) => value === null)) return null;
    const endpoints = readSvgLineEndpoints({
      definitions: context.markerDefinitions,
      element,
      issues: context.issues,
      nodeId,
      strokeCap:
        properties.strokeCap === "round" || properties.strokeCap === "square"
          ? properties.strokeCap
          : "butt",
      strokeJoin: properties.strokeJoin ?? "miter",
    });
    if (!endpoints) return null;
    const geometry = normalizeLineEndpoints(
      { x: x1!, y: y1! },
      { x: x2!, y: y2! },
    );
    const node: DesignNode = {
      ...common,
      kind: "line",
      transform: transformFromSvgMatrix(
        compose(
          transformToSvgMatrix(transform),
          translate(geometry.bounds.x, geometry.bounds.y),
        ),
      ),
      size: {
        width: geometry.bounds.width,
        height: geometry.bounds.height,
      },
      properties: {
        fills: [],
        strokes: properties.strokes,
        strokeWidth: properties.strokeWidth,
        strokeAlign: "center",
        ...(properties.strokeCap === undefined
          ? {}
          : { strokeCap: properties.strokeCap }),
        ...(properties.strokeJoin === undefined
          ? {}
          : { strokeJoin: properties.strokeJoin }),
        ...(properties.dashPattern === undefined
          ? {}
          : { dashPattern: properties.dashPattern }),
        start: geometry.start,
        end: geometry.end,
        ...endpoints,
      },
    };
    context.nodes.push(node);
    return nodeId;
  }

  const pathData = readElementPath(element, tag, context.issues);
  if (!pathData) {
    context.issues.push(
      createSvgIssue(
        "unsupported-element",
        "error",
        `SVG <${tag}> is not supported by the current editable vector slice`,
        { sourceElement: tag },
      ),
    );
    return null;
  }
  const editableVector = readSvgEditableVector(element, pathData);
  if (editableVector.status === "invalid") {
    context.issues.push(
      createSvgIssue("invalid-geometry", "error", editableVector.message, {
        nodeId,
        sourceElement: tag,
      }),
    );
    return null;
  }
  if (editableVector.status === "valid") {
    const normalizedNetwork = normalizeVectorNetwork(
      editableVector.network,
      editableVector.cornerRadius ?? 0,
      editableVector.cornerSmoothing ?? 0,
    );
    if (!normalizedNetwork.ok || !normalizedNetwork.offset) {
      context.issues.push(
        createSvgIssue(
          "invalid-geometry",
          "error",
          normalizedNetwork.ok
            ? "Editable vector metadata could not be normalized"
            : normalizedNetwork.issues[0]?.message ||
                "Editable vector metadata has invalid topology",
          { nodeId, sourceElement: tag },
        ),
      );
      return null;
    }
    const sourceKind = element.getAttribute("data-opendesign-kind");
    const kind = sourceKind === "path" ? "path" : "vector";
    const node: DesignNode = {
      ...common,
      kind,
      transform: transformFromSvgMatrix(
        compose(
          transformToSvgMatrix(transform),
          translate(normalizedNetwork.offset.x, normalizedNetwork.offset.y),
        ),
      ),
      size: {
        width: normalizedNetwork.bounds.width,
        height: normalizedNetwork.bounds.height,
      },
      properties: {
        ...properties,
        network: normalizedNetwork.network,
        fillRule: localStyle.fillRule,
        ...(editableVector.cornerRadius !== undefined
          ? { cornerRadius: editableVector.cornerRadius }
          : {}),
        ...(editableVector.cornerSmoothing !== undefined
          ? { cornerSmoothing: editableVector.cornerSmoothing }
          : {}),
      },
    };
    context.nodes.push(node);
    return nodeId;
  }
  const normalized = context.geometry.normalize({
    path: pathData,
    fillRule: localStyle.fillRule,
  });
  if (!normalized.ok) {
    context.issues.push(
      createSvgIssue("invalid-geometry", "error", normalized.message, {
        sourceElement: tag,
      }),
    );
    return null;
  }
  if (normalized.empty || !normalized.bounds) {
    const sourceKind = element.getAttribute("data-opendesign-kind");
    const kind =
      sourceKind === "path" || sourceKind === "vector" ? sourceKind : "vector";
    const node: DesignNode = {
      ...common,
      kind,
      visible: false,
      transform,
      size: { width: 0, height: 0 },
      properties: {
        ...properties,
        path: "M 0 0",
        fillRule: normalized.fillRule,
      },
    };
    context.nodes.push(node);
    context.issues.push(
      createSvgIssue(
        "empty-geometry",
        "warning",
        `SVG <${tag}> contains no drawable geometry and is imported as an invisible editable Vector`,
        { nodeId, sourceElement: tag },
      ),
    );
    return nodeId;
  }
  const origin = normalized.bounds;
  const localized = context.geometry.transform(
    { path: normalized.path, fillRule: normalized.fillRule },
    [1, 0, 0, 1, -origin.x, -origin.y],
  );
  if (!localized.ok || localized.empty || !localized.bounds) {
    context.issues.push(
      createSvgIssue(
        "invalid-geometry",
        "error",
        localized.ok
          ? `SVG <${tag}> could not be localized`
          : localized.message,
        { sourceElement: tag },
      ),
    );
    return null;
  }
  const sourceKind = element.getAttribute("data-opendesign-kind");
  const kind =
    sourceKind === "path" || sourceKind === "vector" ? sourceKind : "vector";
  const node: DesignNode = {
    ...common,
    kind,
    transform: transformFromSvgMatrix(
      compose(transformToSvgMatrix(transform), translate(origin.x, origin.y)),
    ),
    size: { width: origin.width, height: origin.height },
    properties: {
      ...properties,
      path: localized.path,
      fillRule: localized.fillRule,
    },
  };
  context.nodes.push(node);
  return nodeId;
}

function importEditableVectorRegionContainer(
  context: ImportContext,
  element: Element,
  nodeId: string,
  common: ImportedNodeBase,
  inheritedStyle: ImportedSvgStyle,
  transform: Transform,
): string | null {
  const children = elementChildren(element);
  const sources = children.filter(
    (child) => child.getAttribute("data-opendesign-vector-source") === "true",
  );
  const source = sources[0];
  if (sources.length !== 1) {
    context.issues.push(
      createSvgIssue(
        "invalid-geometry",
        "error",
        "Editable vector region container requires exactly one source path",
        { nodeId, sourceElement: element.localName },
      ),
    );
    return null;
  }
  if (!source || source.localName.toLowerCase() !== "path") {
    context.issues.push(
      createSvgIssue(
        "invalid-geometry",
        "error",
        "Editable vector region container requires one source path",
        { nodeId, sourceElement: element.localName },
      ),
    );
    return null;
  }
  const pathData = source.getAttribute("d")?.trim();
  if (!pathData) return null;
  const editable = readSvgEditableVector(source, pathData);
  if (editable.status !== "valid") {
    context.issues.push(
      createSvgIssue(
        "invalid-geometry",
        "error",
        editable.status === "invalid"
          ? editable.message
          : "Editable vector region metadata is missing",
        { nodeId, sourceElement: source.localName },
      ),
    );
    return null;
  }
  if (
    !renderedVectorRegionsMatch(
      context,
      children,
      editable.network,
      editable.cornerRadius ?? 0,
      editable.cornerSmoothing ?? 0,
    )
  ) {
    return null;
  }
  const normalized = normalizeVectorNetwork(
    editable.network,
    editable.cornerRadius ?? 0,
    editable.cornerSmoothing ?? 0,
  );
  if (!normalized.ok || !normalized.offset) return null;
  const sourceStyle = readImportedSvgStyle(
    source,
    inheritedStyle,
    context.issues,
  );
  const properties = importSvgShapeProperties(
    context,
    source,
    sourceStyle,
    nodeId,
  );
  if (!properties) return null;
  const sourceKind = source.getAttribute("data-opendesign-kind");
  const node: DesignNode = {
    ...common,
    kind: sourceKind === "path" ? "path" : "vector",
    transform: transformFromSvgMatrix(
      compose(
        transformToSvgMatrix(transform),
        translate(normalized.offset.x, normalized.offset.y),
      ),
    ),
    size: {
      width: normalized.bounds.width,
      height: normalized.bounds.height,
    },
    properties: {
      ...properties,
      fills: editable.fallbackFills,
      network: normalized.network,
      fillRule: sourceStyle.fillRule,
      ...(editable.cornerRadius !== undefined
        ? { cornerRadius: editable.cornerRadius }
        : {}),
      ...(editable.cornerSmoothing !== undefined
        ? { cornerSmoothing: editable.cornerSmoothing }
        : {}),
    },
  };
  context.nodes.push(node);
  return nodeId;
}

function renderedVectorRegionsMatch(
  context: ImportContext,
  children: readonly Element[],
  network: Extract<
    ReturnType<typeof readSvgEditableVector>,
    { status: "valid" }
  >["network"],
  cornerRadius: number,
  cornerSmoothing: number,
): boolean {
  const rendered = children.filter((child) =>
    child.hasAttribute("data-opendesign-vector-region-id"),
  );
  const strokeParts = children.filter((child) =>
    child.hasAttribute("data-opendesign-vector-stroke-part"),
  );
  if (
    rendered.length !== network.regions.length ||
    children.length !== rendered.length + strokeParts.length + 1
  ) {
    context.issues.push(
      createSvgIssue(
        "invalid-geometry",
        "error",
        "Editable vector region metadata does not match rendered region count",
      ),
    );
    return false;
  }
  for (const region of network.regions) {
    const element = rendered.find(
      (candidate) =>
        candidate.getAttribute("data-opendesign-vector-region-id") ===
        region.id,
    );
    const serialized = serializeVectorRegion(
      network,
      region.id,
      cornerRadius,
      cornerSmoothing,
    );
    if (
      !element ||
      element.localName.toLowerCase() !== "path" ||
      element.getAttribute("fill-rule") !== region.windingRule ||
      !serialized.ok ||
      normalizeSvgPath(element.getAttribute("d") ?? "") !==
        normalizeSvgPath(serialized.path)
    ) {
      context.issues.push(
        createSvgIssue(
          "invalid-geometry",
          "error",
          `Editable vector region ${region.id} does not match its rendered path`,
        ),
      );
      return false;
    }
  }
  return true;
}

function normalizeSvgPath(value: string): string {
  return value.trim().replace(/[\t\n\r ]+/g, " ");
}

function importFrameElement(
  context: ImportContext,
  element: Element,
  nodeId: string,
  common: ImportedNodeBase,
  inheritedStyle: ImportedSvgStyle,
  transform: Transform,
  depth: number,
): string | null {
  const structuralChildren = elementChildren(element).filter(
    (child) =>
      !["defs", "title", "desc", "metadata"].includes(
        child.localName.toLowerCase(),
      ),
  );
  const backgrounds = structuralChildren.filter(
    (child) =>
      child.localName.toLowerCase() === "rect" &&
      child.getAttribute("data-opendesign-frame-background") === "true",
  );
  if (backgrounds.length !== 1 || structuralChildren[0] !== backgrounds[0]) {
    context.issues.push(
      createSvgIssue(
        "unsupported-element",
        "error",
        "OpenDesign SVG Frame requires exactly one leading frame background rect",
        { nodeId, sourceElement: element.localName },
      ),
    );
    return null;
  }
  const background = backgrounds[0]!;
  if (
    background.hasAttribute("transform") ||
    background.hasAttribute("filter") ||
    background.hasAttribute("mask") ||
    background.hasAttribute("clip-path") ||
    readSvgOpacity(background.getAttribute("opacity"), 1) !== 1
  ) {
    context.issues.push(
      createSvgIssue(
        "unsupported-element",
        "error",
        "OpenDesign SVG Frame background contains unsupported structural appearance",
        { nodeId, sourceElement: background.localName },
      ),
    );
    return null;
  }
  const x = readSvgLength(background, "x", 0, context.issues);
  const y = readSvgLength(background, "y", 0, context.issues);
  const width = readSvgLength(background, "width", null, context.issues);
  const height = readSvgLength(background, "height", null, context.issues);
  const radius = readSvgLength(background, "rx", 0, context.issues);
  if (
    x !== 0 ||
    y !== 0 ||
    !isPositiveSvgLength(width) ||
    !isPositiveSvgLength(height) ||
    radius === null ||
    radius < 0
  ) {
    context.issues.push(
      createSvgIssue(
        "invalid-dimension",
        "error",
        "OpenDesign SVG Frame background requires origin-zero positive bounds and a non-negative corner radius",
        { nodeId, sourceElement: background.localName },
      ),
    );
    return null;
  }
  const backgroundStyle = readImportedSvgStyle(
    background,
    inheritedStyle,
    context.issues,
  );
  const shape = importSvgShapeProperties(
    context,
    background,
    backgroundStyle,
    nodeId,
  );
  if (!shape) return null;

  const contentElements = structuralChildren.slice(1);
  const contentWrappers = contentElements.filter(
    (child) => child.getAttribute("data-opendesign-frame-content") === "true",
  );
  let clipsContent = false;
  let children: readonly Element[] = contentElements;
  if (contentWrappers.length > 0) {
    if (contentWrappers.length !== 1 || contentElements.length !== 1) {
      context.issues.push(
        createSvgIssue(
          "mask-omitted",
          "error",
          "OpenDesign SVG Frame clipping wrapper must be the only content container",
          { nodeId, sourceElement: element.localName },
        ),
      );
      return null;
    }
    const wrapper = contentWrappers[0]!;
    if (
      wrapper.hasAttribute("transform") ||
      wrapper.hasAttribute("filter") ||
      wrapper.hasAttribute("mask") ||
      wrapper.hasAttribute("opacity") ||
      wrapper.hasAttribute("display") ||
      wrapper.hasAttribute("visibility")
    ) {
      context.issues.push(
        createSvgIssue(
          "mask-omitted",
          "error",
          "OpenDesign SVG Frame clipping wrapper contains unsupported appearance or transform",
          { nodeId, sourceElement: wrapper.localName },
        ),
      );
      return null;
    }
    const referenceId = parseLocalSvgUrlReference(
      readSvgStyleOrAttribute(wrapper, "clip-path"),
    );
    const definition = referenceId
      ? context.maskDefinitions.get(referenceId)
      : undefined;
    if (
      !referenceId ||
      !definition ||
      !validateSvgFrameClipDefinition(definition, width, height, radius)
    ) {
      context.issues.push(
        createSvgIssue(
          "mask-omitted",
          "error",
          "OpenDesign SVG Frame clipping definition is missing or does not match the Frame bounds",
          { nodeId, sourceElement: wrapper.localName },
        ),
      );
      return null;
    }
    clipsContent = true;
    children = elementChildren(wrapper);
  }

  const childIds = importContainerChildren(
    context,
    children,
    nodeId,
    inheritedStyle,
    depth + 1,
  );
  const frame: DesignNode = {
    ...common,
    kind: "frame",
    childIds,
    transform,
    size: { width, height },
    properties: {
      ...shape,
      cornerRadius: radius,
      clipsContent,
    },
  };
  context.nodes.push(frame);
  return nodeId;
}

function readElementPath(
  element: Element,
  tag: string,
  issues: SvgInterchangeIssue[],
): string | null {
  if (tag === "path") return element.getAttribute("d")?.trim() || null;
  if (tag === "line") {
    const x1 = readSvgLength(element, "x1", 0, issues);
    const y1 = readSvgLength(element, "y1", 0, issues);
    const x2 = readSvgLength(element, "x2", 0, issues);
    const y2 = readSvgLength(element, "y2", 0, issues);
    if ([x1, y1, x2, y2].some((value) => value === null)) return null;
    return `M ${formatSvgNumber(x1!)} ${formatSvgNumber(y1!)} L ${formatSvgNumber(x2!)} ${formatSvgNumber(y2!)}`;
  }
  if (tag === "polygon" || tag === "polyline") {
    const values = (element.getAttribute("points") ?? "")
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    if (
      values.length < 4 ||
      values.length % 2 !== 0 ||
      !values.every(Number.isFinite)
    ) {
      return null;
    }
    const commands: string[] = [];
    for (let index = 0; index < values.length; index += 2) {
      commands.push(
        `${index === 0 ? "M" : "L"} ${formatSvgNumber(values[index]!)} ${formatSvgNumber(values[index + 1]!)}`,
      );
    }
    if (tag === "polygon") commands.push("Z");
    return commands.join(" ");
  }
  return null;
}

function elementChildren(element: Element): Element[] {
  const children: Element[] = [];
  for (let index = 0; index < element.childNodes.length; index += 1) {
    const child = element.childNodes.item(index);
    if (child?.nodeType === 1) children.push(child as Element);
  }
  return children;
}

function readSvgName(element: Element): string {
  return (
    element.getAttribute("data-name") ||
    element.getAttribute("aria-label") ||
    element.getAttribute("id") ||
    ""
  ).trim();
}

function nextImportedNodeId(context: ImportContext, tag: string): string {
  context.nodeSequence += 1;
  return `${context.idPrefix}_${context.nodeSequence.toString().padStart(4, "0")}_${sanitizeSvgXmlId(tag)}`;
}

function capitalize(value: string): string {
  return value.length === 0
    ? value
    : `${value[0]!.toUpperCase()}${value.slice(1)}`;
}
