import type { DesignNode, Effect } from "@opendesign/design-contracts";
import type {
  SvgInterchangeIssue,
  SvgInterchangeIssueCode,
  SvgInterchangeIssueSeverity,
} from "./svg-issues.js";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const OPENDESIGN_FILTER_VERSION = "1";
const MAX_DROP_SHADOWS = 8;
const MAX_LAYER_BLURS = 1;
const MAX_FILTER_DEFINITIONS = 2_048;
const MAX_FILTER_PRIMITIVES = 64;
const MAX_FILTER_OFFSET = 1_000_000;
const MAX_FILTER_RADIUS = 4_096;
const GAUSSIAN_SIGMA_FACTOR = 0.5;
const FILTER_KERNEL_OUTSET = 4;

type DropShadowEffect = Extract<Effect, { type: "drop-shadow" }>;
type LayerBlurEffect = Extract<Effect, { type: "layer-blur" }>;
type SupportedSvgEffect = DropShadowEffect | LayerBlurEffect;

export interface AppendSvgEffectFilterOptions {
  definitions: Element;
  document: Document;
  filterId: string;
  node: DesignNode;
}

export interface AppendSvgEffectFilterResult {
  filterId?: string;
  issues: readonly SvgInterchangeIssue[];
}

export interface ReadSvgFilterEffectsOptions {
  definitions: ReadonlyMap<string, Element>;
  element: Element;
  nodeId: string;
}

export interface ReadSvgFilterEffectsResult {
  effects: readonly Effect[];
  issues: readonly SvgInterchangeIssue[];
}

/**
 * Appends one standards-based SVG filter for the supported OpenDesign effect
 * subset. Drop shadows are expanded to independent shadow-only branches before
 * feMerge: feDropShadow itself also merges SourceGraphic, so merging several
 * shorthand results would incorrectly accumulate translucent source pixels.
 */
export function appendSvgEffectFilter(
  options: AppendSvgEffectFilterOptions,
): AppendSvgEffectFilterResult {
  const issues: SvgInterchangeIssue[] = [];
  const supported = collectSupportedEffects(options.node, issues);
  if (supported.length === 0) return { issues };

  const filter = options.document.createElementNS(SVG_NAMESPACE, "filter");
  filter.setAttribute("id", options.filterId);
  filter.setAttribute(
    "data-opendesign-filter-version",
    OPENDESIGN_FILTER_VERSION,
  );
  filter.setAttribute("filterUnits", "userSpaceOnUse");
  filter.setAttribute("primitiveUnits", "userSpaceOnUse");
  filter.setAttribute("color-interpolation-filters", "sRGB");
  applyFilterRegion(filter, options.node, supported);

  const visibleShadowResults: string[] = [];
  let visibleSourceResult = "SourceGraphic";
  for (const [index, effect] of supported.entries()) {
    const effectPrefix = `od_effect_${index + 1}`;
    if (effect.type === "drop-shadow") {
      const blurResult = `${effectPrefix}_blur`;
      const offsetResult = `${effectPrefix}_offset`;
      const colorResult = `${effectPrefix}_color`;
      const shadowResult = `${effectPrefix}_shadow`;

      const blur = options.document.createElementNS(
        SVG_NAMESPACE,
        "feGaussianBlur",
      );
      blur.setAttribute("in", "SourceAlpha");
      blur.setAttribute(
        "stdDeviation",
        formatNumber(effect.blur * GAUSSIAN_SIGMA_FACTOR),
      );
      blur.setAttribute("result", blurResult);
      applyEffectMetadata(blur, effect, index);
      filter.appendChild(blur);

      const offset = options.document.createElementNS(
        SVG_NAMESPACE,
        "feOffset",
      );
      offset.setAttribute("in", blurResult);
      offset.setAttribute("dx", formatNumber(effect.offset.x));
      offset.setAttribute("dy", formatNumber(effect.offset.y));
      offset.setAttribute("result", offsetResult);
      filter.appendChild(offset);

      const flood = options.document.createElementNS(SVG_NAMESPACE, "feFlood");
      flood.setAttribute("flood-color", effect.color);
      flood.setAttribute("flood-opacity", formatNumber(effect.opacity));
      flood.setAttribute("result", colorResult);
      filter.appendChild(flood);

      const composite = options.document.createElementNS(
        SVG_NAMESPACE,
        "feComposite",
      );
      composite.setAttribute("in", colorResult);
      composite.setAttribute("in2", offsetResult);
      composite.setAttribute("operator", "in");
      composite.setAttribute("result", shadowResult);
      filter.appendChild(composite);
      if (effect.visible !== false) visibleShadowResults.push(shadowResult);
      continue;
    }

    const blur = options.document.createElementNS(
      SVG_NAMESPACE,
      "feGaussianBlur",
    );
    blur.setAttribute("in", "SourceGraphic");
    blur.setAttribute(
      "stdDeviation",
      formatNumber(effect.radius * GAUSSIAN_SIGMA_FACTOR),
    );
    const result = `${effectPrefix}_layer`;
    blur.setAttribute("result", result);
    applyEffectMetadata(blur, effect, index);
    filter.appendChild(blur);
    if (effect.visible !== false) visibleSourceResult = result;
  }

  const merge = options.document.createElementNS(SVG_NAMESPACE, "feMerge");
  merge.setAttribute("data-opendesign-effect-composite", "true");
  for (const input of [...visibleShadowResults, visibleSourceResult]) {
    const mergeNode = options.document.createElementNS(
      SVG_NAMESPACE,
      "feMergeNode",
    );
    mergeNode.setAttribute("in", input);
    merge.appendChild(mergeNode);
  }
  filter.appendChild(merge);
  options.definitions.appendChild(filter);
  return { filterId: options.filterId, issues };
}

export function collectSvgFilterDefinitions(
  root: Element,
): ReadonlyMap<string, Element> {
  const definitions = new Map<string, Element>();
  const pending = [root];
  while (pending.length > 0) {
    const element = pending.pop();
    if (!element) break;
    const id = element.getAttribute("id");
    if (id && element.localName.toLowerCase() === "filter") {
      if (definitions.size >= MAX_FILTER_DEFINITIONS) break;
      definitions.set(id, element);
    }
    pending.push(...elementChildren(element));
  }
  return definitions;
}

/** Reads only local, bounded filter graphs with semantics OpenDesign can own. */
export function readSvgFilterEffects(
  options: ReadSvgFilterEffectsOptions,
): ReadSvgFilterEffectsResult {
  const value = readStyleOrAttribute(options.element, "filter")?.trim();
  if (!value || value === "none") return { effects: [], issues: [] };
  const localReference = /^url\(\s*(['"]?)#([^'"()\s]+)\1\s*\)$/i.exec(value);
  if (!localReference) {
    if (/^url\(/i.test(value)) {
      return {
        effects: [],
        issues: [
          issue(
            "external-reference",
            "error",
            `SVG filter reference ${value} is not a local fragment`,
            options,
          ),
        ],
      };
    }
    return unsupported(
      options,
      `SVG filter value ${value} is outside the editable url(#id) subset`,
    );
  }
  const filterId = localReference[2]!;
  const definition = options.definitions.get(filterId);
  if (!definition) {
    return unsupported(
      options,
      `SVG filter #${filterId} does not resolve to a local <filter> definition`,
    );
  }
  const primitives = elementChildren(definition).filter(
    (element) =>
      element.localName.toLowerCase() !== "title" &&
      element.localName.toLowerCase() !== "desc",
  );
  if (primitives.length === 0 || primitives.length > MAX_FILTER_PRIMITIVES) {
    return unsupported(
      options,
      `SVG filter #${filterId} must contain between 1 and ${MAX_FILTER_PRIMITIVES} supported primitives`,
    );
  }

  if (
    definition.getAttribute("data-opendesign-filter-version") ===
      OPENDESIGN_FILTER_VERSION ||
    primitives.some((primitive) =>
      primitive.hasAttribute("data-opendesign-effect-type"),
    )
  ) {
    return readGeneratedFilter(options, filterId, primitives);
  }
  return readSimpleStandardFilter(options, filterId, primitives);
}

function collectSupportedEffects(
  node: DesignNode,
  issues: SvgInterchangeIssue[],
): SupportedSvgEffect[] {
  const supported: SupportedSvgEffect[] = [];
  let shadows = 0;
  let blurs = 0;
  for (const effect of node.effects ?? []) {
    if (effect.type === "drop-shadow") {
      if (shadows >= MAX_DROP_SHADOWS) {
        issues.push(
          omitted(
            node.id,
            `Drop shadow ${shadows + 1} exceeds the SVG fidelity limit of ${MAX_DROP_SHADOWS} shadows per layer`,
          ),
        );
        shadows += 1;
        continue;
      }
      shadows += 1;
      if (effect.spread !== 0) {
        issues.push(
          omitted(
            node.id,
            `Drop shadow ${shadows} on ${node.id} uses spread ${formatNumber(effect.spread)}; SVG morphology fidelity is not implemented`,
          ),
        );
        continue;
      }
      if (effect.blendMode !== undefined && effect.blendMode !== "normal") {
        issues.push(
          omitted(
            node.id,
            `Drop shadow ${shadows} on ${node.id} uses unsupported blend mode ${effect.blendMode}`,
          ),
        );
        continue;
      }
      if (
        !bounded(effect.blur, 0, MAX_FILTER_RADIUS) ||
        !bounded(effect.offset.x, -MAX_FILTER_OFFSET, MAX_FILTER_OFFSET) ||
        !bounded(effect.offset.y, -MAX_FILTER_OFFSET, MAX_FILTER_OFFSET) ||
        !bounded(effect.opacity, 0, 1)
      ) {
        issues.push(
          omitted(
            node.id,
            `Drop shadow ${shadows} on ${node.id} exceeds the finite SVG filter budget`,
          ),
        );
        continue;
      }
      supported.push(effect);
      continue;
    }
    if (effect.type === "layer-blur") {
      blurs += 1;
      if (blurs > MAX_LAYER_BLURS) {
        issues.push(
          omitted(
            node.id,
            `Layer blur ${blurs} exceeds the professional one-layer-blur semantic`,
          ),
        );
        continue;
      }
      if (!bounded(effect.radius, 0, MAX_FILTER_RADIUS)) {
        issues.push(
          omitted(
            node.id,
            `Layer blur on ${node.id} exceeds the finite SVG filter budget`,
          ),
        );
        continue;
      }
      supported.push(effect);
      continue;
    }
    issues.push(
      omitted(
        node.id,
        `${effect.type} on ${node.id} is not preserved by the basic SVG filter subset`,
      ),
    );
  }
  return supported;
}

function applyEffectMetadata(
  primitive: Element,
  effect: SupportedSvgEffect,
  index: number,
): void {
  primitive.setAttribute("data-opendesign-effect-index", String(index));
  primitive.setAttribute("data-opendesign-effect-type", effect.type);
  primitive.setAttribute(
    "data-opendesign-effect-visible",
    effect.visible === false ? "false" : "true",
  );
  if (effect.type === "drop-shadow" && effect.blendMode === "normal") {
    primitive.setAttribute("data-opendesign-effect-blend-mode", "normal");
  }
}

function applyFilterRegion(
  filter: Element,
  node: DesignNode,
  effects: readonly SupportedSvgEffect[],
): void {
  const strokeOutset = nodeStrokeOutset(node);
  let minX = -strokeOutset;
  let minY = -strokeOutset;
  let maxX = Math.max(0, node.size.width) + strokeOutset;
  let maxY = Math.max(0, node.size.height) + strokeOutset;
  for (const effect of effects) {
    if (effect.visible === false) continue;
    const radius =
      (effect.type === "drop-shadow" ? effect.blur : effect.radius) *
      GAUSSIAN_SIGMA_FACTOR *
      FILTER_KERNEL_OUTSET;
    if (effect.type === "drop-shadow") {
      minX = Math.min(minX, effect.offset.x - strokeOutset - radius);
      minY = Math.min(minY, effect.offset.y - strokeOutset - radius);
      maxX = Math.max(
        maxX,
        node.size.width + effect.offset.x + strokeOutset + radius,
      );
      maxY = Math.max(
        maxY,
        node.size.height + effect.offset.y + strokeOutset + radius,
      );
    } else {
      minX = Math.min(minX, -strokeOutset - radius);
      minY = Math.min(minY, -strokeOutset - radius);
      maxX = Math.max(maxX, node.size.width + strokeOutset + radius);
      maxY = Math.max(maxY, node.size.height + strokeOutset + radius);
    }
  }
  filter.setAttribute("x", formatNumber(minX));
  filter.setAttribute("y", formatNumber(minY));
  filter.setAttribute("width", formatNumber(Math.max(1, maxX - minX)));
  filter.setAttribute("height", formatNumber(Math.max(1, maxY - minY)));
}

function nodeStrokeOutset(node: DesignNode): number {
  if (
    node.kind !== "boolean" &&
    node.kind !== "ellipse" &&
    node.kind !== "frame" &&
    node.kind !== "path" &&
    node.kind !== "rectangle" &&
    node.kind !== "text" &&
    node.kind !== "vector"
  ) {
    return 0;
  }
  const visibleStroke = node.properties.strokes.some(
    (paint) => paint.visible !== false && paint.opacity > 0,
  );
  if (!visibleStroke || node.properties.strokeWidth <= 0) return 0;
  if (node.properties.strokeAlign === "outside") {
    return node.properties.strokeWidth;
  }
  return node.properties.strokeAlign === "inside"
    ? 0
    : node.properties.strokeWidth / 2;
}

function readGeneratedFilter(
  options: ReadSvgFilterEffectsOptions,
  filterId: string,
  primitives: readonly Element[],
): ReadSvgFilterEffectsResult {
  const merge = primitives.at(-1);
  if (
    !merge ||
    merge.localName.toLowerCase() !== "femerge" ||
    merge.getAttribute("data-opendesign-effect-composite") !== "true"
  ) {
    return unsupported(
      options,
      `SVG filter #${filterId} does not end in the expected OpenDesign effect composite`,
    );
  }
  const effects: Effect[] = [];
  const visibleShadowResults: string[] = [];
  let visibleSourceResult = "SourceGraphic";
  let shadowCount = 0;
  let blurCount = 0;
  const results = new Set<string>();

  for (let index = 0; index < primitives.length - 1;) {
    const primitive = primitives[index]!;
    const tag = primitive.localName.toLowerCase();
    const type = primitive.getAttribute("data-opendesign-effect-type");
    const visible = readEffectVisibility(primitive);
    if (visible === null || tag !== "fegaussianblur") {
      return unsupported(
        options,
        `SVG filter #${filterId} contains an invalid effect metadata block`,
      );
    }
    if (type === "drop-shadow") {
      shadowCount += 1;
      if (
        shadowCount > MAX_DROP_SHADOWS ||
        index + 3 >= primitives.length - 1
      ) {
        return unsupported(
          options,
          `SVG filter #${filterId} exceeds the supported drop-shadow graph budget`,
        );
      }
      const offset = primitives[index + 1]!;
      const flood = primitives[index + 2]!;
      const composite = primitives[index + 3]!;
      const blurResult = resultName(primitive, results);
      const offsetResult = resultName(offset, results);
      const colorResult = resultName(flood, results);
      const shadowResult = resultName(composite, results);
      if (
        !blurResult ||
        !offsetResult ||
        !colorResult ||
        !shadowResult ||
        primitive.getAttribute("in") !== "SourceAlpha" ||
        offset.localName.toLowerCase() !== "feoffset" ||
        offset.getAttribute("in") !== blurResult ||
        flood.localName.toLowerCase() !== "feflood" ||
        composite.localName.toLowerCase() !== "fecomposite" ||
        composite.getAttribute("in") !== colorResult ||
        composite.getAttribute("in2") !== offsetResult ||
        composite.getAttribute("operator") !== "in"
      ) {
        return unsupported(
          options,
          `SVG filter #${filterId} contains an unsupported drop-shadow primitive chain`,
        );
      }
      const sigma = readStandardDeviation(primitive);
      const dx = readBoundedAttribute(offset, "dx", 0, MAX_FILTER_OFFSET);
      const dy = readBoundedAttribute(offset, "dy", 0, MAX_FILTER_OFFSET);
      const opacity = readOpacityAttribute(flood, 1);
      const color = readStyleOrAttribute(flood, "flood-color")?.trim();
      const blendMode = primitive.hasAttribute(
        "data-opendesign-effect-blend-mode",
      )
        ? primitive.getAttribute("data-opendesign-effect-blend-mode")
        : null;
      if (
        sigma === null ||
        dx === null ||
        dy === null ||
        opacity === null ||
        (blendMode !== null && blendMode !== "normal")
      ) {
        return unsupported(
          options,
          `SVG filter #${filterId} contains non-finite drop-shadow values`,
        );
      }
      effects.push({
        type: "drop-shadow",
        color: color || "#000000",
        opacity,
        offset: { x: dx, y: dy },
        blur: sigma / GAUSSIAN_SIGMA_FACTOR,
        spread: 0,
        ...(visible ? {} : { visible: false }),
        ...(blendMode === null ? {} : { blendMode: "normal" as const }),
      });
      if (visible) visibleShadowResults.push(shadowResult);
      index += 4;
      continue;
    }
    if (type === "layer-blur") {
      blurCount += 1;
      if (
        blurCount > MAX_LAYER_BLURS ||
        primitive.getAttribute("in") !== "SourceGraphic"
      ) {
        return unsupported(
          options,
          `SVG filter #${filterId} contains more than one layer blur or an unsupported blur input`,
        );
      }
      const result = resultName(primitive, results);
      const sigma = readStandardDeviation(primitive);
      if (!result || sigma === null) {
        return unsupported(
          options,
          `SVG filter #${filterId} contains invalid layer-blur values`,
        );
      }
      effects.push({
        type: "layer-blur",
        radius: sigma / GAUSSIAN_SIGMA_FACTOR,
        ...(visible ? {} : { visible: false }),
      });
      if (visible) visibleSourceResult = result;
      index += 1;
      continue;
    }
    return unsupported(
      options,
      `SVG filter #${filterId} contains unsupported OpenDesign effect type ${type ?? "(missing)"}`,
    );
  }

  const mergeInputs = elementChildren(merge).map((node) => {
    if (node.localName.toLowerCase() !== "femergenode") return null;
    return node.getAttribute("in");
  });
  const expectedInputs = [...visibleShadowResults, visibleSourceResult];
  if (
    mergeInputs.some((input) => input === null) ||
    mergeInputs.length !== expectedInputs.length ||
    mergeInputs.some((input, index) => input !== expectedInputs[index])
  ) {
    return unsupported(
      options,
      `SVG filter #${filterId} composite inputs do not match its visible effect branches`,
    );
  }
  return { effects, issues: [] };
}

function readSimpleStandardFilter(
  options: ReadSvgFilterEffectsOptions,
  filterId: string,
  primitives: readonly Element[],
): ReadSvgFilterEffectsResult {
  if (primitives.length !== 1) {
    return unsupported(
      options,
      `SVG filter #${filterId} is a complex graph; only a single feDropShadow, a single feGaussianBlur, or an OpenDesign effect graph is editable`,
    );
  }
  const primitive = primitives[0]!;
  const tag = primitive.localName.toLowerCase();
  if (tag === "fedropshadow") {
    const input = primitive.getAttribute("in") || "SourceGraphic";
    const sigma = readStandardDeviation(primitive, 2);
    const dx = readBoundedAttribute(primitive, "dx", 2, MAX_FILTER_OFFSET);
    const dy = readBoundedAttribute(primitive, "dy", 2, MAX_FILTER_OFFSET);
    const opacity = readOpacityAttribute(primitive, 1);
    const color = readStyleOrAttribute(primitive, "flood-color")?.trim();
    if (
      input !== "SourceGraphic" ||
      sigma === null ||
      dx === null ||
      dy === null ||
      opacity === null
    ) {
      return unsupported(
        options,
        `SVG filter #${filterId} uses unsupported feDropShadow input or values`,
      );
    }
    return {
      effects: [
        {
          type: "drop-shadow",
          color: color || "#000000",
          opacity,
          offset: { x: dx, y: dy },
          blur: sigma / GAUSSIAN_SIGMA_FACTOR,
          spread: 0,
        },
      ],
      issues: [],
    };
  }
  if (tag === "fegaussianblur") {
    const input = primitive.getAttribute("in") || "SourceGraphic";
    const sigma = readStandardDeviation(primitive, 0);
    if (input !== "SourceGraphic" || sigma === null) {
      return unsupported(
        options,
        `SVG filter #${filterId} uses unsupported feGaussianBlur input or values`,
      );
    }
    return {
      effects: [
        {
          type: "layer-blur",
          radius: sigma / GAUSSIAN_SIGMA_FACTOR,
        },
      ],
      issues: [],
    };
  }
  return unsupported(
    options,
    `SVG filter #${filterId} uses unsupported primitive <${primitive.localName}>`,
  );
}

function readEffectVisibility(element: Element): boolean | null {
  const value = element.getAttribute("data-opendesign-effect-visible");
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function resultName(element: Element, seen: Set<string>): string | null {
  const value = element.getAttribute("result")?.trim();
  if (
    !value ||
    seen.has(value) ||
    value === "SourceGraphic" ||
    value === "SourceAlpha"
  ) {
    return null;
  }
  seen.add(value);
  return value;
}

function readStandardDeviation(
  element: Element,
  fallback?: number,
): number | null {
  const raw = element.getAttribute("stdDeviation")?.trim();
  if (!raw) return fallback ?? null;
  const values = raw
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  if (
    values.length !== 1 ||
    !bounded(values[0]!, 0, MAX_FILTER_RADIUS * GAUSSIAN_SIGMA_FACTOR)
  ) {
    return null;
  }
  return values[0]!;
}

function readBoundedAttribute(
  element: Element,
  name: string,
  fallback: number,
  maximumAbsolute: number,
): number | null {
  const value = element.getAttribute(name);
  if (value === null || value.trim() === "") return fallback;
  const parsed = Number(value);
  return bounded(parsed, -maximumAbsolute, maximumAbsolute) ? parsed : null;
}

function readOpacityAttribute(
  element: Element,
  fallback: number,
): number | null {
  const value = readStyleOrAttribute(element, "flood-opacity");
  if (value === null || value.trim() === "") return fallback;
  const parsed = Number(value);
  return bounded(parsed, 0, 1) ? parsed : null;
}

function readStyleOrAttribute(element: Element, name: string): string | null {
  const style = element.getAttribute("style");
  if (style) {
    for (const declaration of style.split(";")) {
      const separator = declaration.indexOf(":");
      if (separator <= 0) continue;
      if (
        declaration.slice(0, separator).trim().toLowerCase() ===
        name.toLowerCase()
      ) {
        return declaration.slice(separator + 1).trim();
      }
    }
  }
  return element.hasAttribute(name) ? element.getAttribute(name) : null;
}

function elementChildren(element: Element): Element[] {
  const children: Element[] = [];
  for (let index = 0; index < element.childNodes.length; index += 1) {
    const child = element.childNodes.item(index);
    if (child?.nodeType === 1) children.push(child as Element);
  }
  return children;
}

function unsupported(
  options: Pick<ReadSvgFilterEffectsOptions, "element" | "nodeId">,
  message: string,
): ReadSvgFilterEffectsResult {
  return {
    effects: [],
    issues: [issue("unsupported-filter", "warning", message, options)],
  };
}

function omitted(nodeId: string, message: string): SvgInterchangeIssue {
  return issue("effect-omitted", "warning", message, { nodeId });
}

function issue(
  code: SvgInterchangeIssueCode,
  severity: SvgInterchangeIssueSeverity,
  message: string,
  context: {
    element?: Element;
    nodeId?: string;
  },
): SvgInterchangeIssue {
  return {
    code,
    severity,
    message,
    ...(context.nodeId === undefined ? {} : { nodeId: context.nodeId }),
    ...(context.element === undefined
      ? {}
      : { sourceElement: context.element.localName }),
  };
}

function bounded(value: number, minimum: number, maximum: number): boolean {
  return Number.isFinite(value) && value >= minimum && value <= maximum;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}
