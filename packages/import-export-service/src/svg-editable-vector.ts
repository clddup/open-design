import {
  PaintSchema,
  Type,
  VectorNetworkSchema,
  type Paint,
  type VectorNetwork,
} from "@opendesign/design-contracts";
import { defineContract } from "@opendesign/contract-runtime";
import {
  serializeVectorNetwork,
  validateVectorNetwork,
} from "@opendesign/geometry-service/editable-vector";

const VECTOR_NETWORK_VERSION = "6";
const SUPPORTED_VECTOR_NETWORK_VERSIONS = new Set([
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
]);
const VERSION_ATTRIBUTE = "data-opendesign-vector-network-version";
const NETWORK_ATTRIBUTE = "data-opendesign-vector-network";
const FALLBACK_FILLS_ATTRIBUTE = "data-opendesign-vector-fallback-fills";
const CORNER_RADIUS_ATTRIBUTE = "data-opendesign-vector-corner-radius";
const CORNER_SMOOTHING_ATTRIBUTE = "data-opendesign-vector-corner-smoothing";
const MAX_NETWORK_CHARACTERS = 1_000_000;
const PaintsSchema = Type.Array(PaintSchema, { maxItems: 4_096 });
const VectorNetworkContract = defineContract<VectorNetwork>({
  schema: VectorNetworkSchema,
  code: "svg_vector.network_structure_invalid",
  subject: "SVG editable vector network",
  clone: false,
});
const FallbackFillsContract = defineContract<Paint[]>({
  schema: PaintsSchema,
  code: "svg_vector.fallback_fills_structure_invalid",
  subject: "SVG editable vector fallback fills",
  clone: false,
});

export type SvgEditableVectorReadResult =
  | { status: "absent" }
  | { status: "invalid"; message: string }
  | {
      status: "valid";
      cornerRadius?: number;
      cornerSmoothing?: number;
      fallbackFills: Paint[];
      network: VectorNetwork;
    };

export function writeSvgEditableVector(
  element: Element,
  network: VectorNetwork,
  fallbackFills: readonly Paint[] = [],
  cornerRadius = 0,
  cornerSmoothing = 0,
): boolean {
  const serialized = JSON.stringify(portableVectorNetwork(network));
  const serializedFills = JSON.stringify(fallbackFills);
  if (
    !Number.isFinite(cornerRadius) ||
    cornerRadius < 0 ||
    !Number.isFinite(cornerSmoothing) ||
    cornerSmoothing < 0 ||
    cornerSmoothing > 1 ||
    serialized.length + serializedFills.length > MAX_NETWORK_CHARACTERS
  ) {
    element.removeAttribute(VERSION_ATTRIBUTE);
    element.removeAttribute(NETWORK_ATTRIBUTE);
    element.removeAttribute(FALLBACK_FILLS_ATTRIBUTE);
    element.removeAttribute(CORNER_RADIUS_ATTRIBUTE);
    element.removeAttribute(CORNER_SMOOTHING_ATTRIBUTE);
    return false;
  }
  element.setAttribute(VERSION_ATTRIBUTE, VECTOR_NETWORK_VERSION);
  element.setAttribute(NETWORK_ATTRIBUTE, serialized);
  element.setAttribute(FALLBACK_FILLS_ATTRIBUTE, serializedFills);
  element.setAttribute(CORNER_RADIUS_ATTRIBUTE, String(cornerRadius));
  element.setAttribute(CORNER_SMOOTHING_ATTRIBUTE, String(cornerSmoothing));
  return true;
}

export function readSvgEditableVector(
  element: Element,
  pathData: string,
): SvgEditableVectorReadResult {
  const hasMetadata =
    element.hasAttribute(VERSION_ATTRIBUTE) ||
    element.hasAttribute(NETWORK_ATTRIBUTE);
  if (!hasMetadata) return { status: "absent" };
  if (element.localName.toLowerCase() !== "path") {
    return invalid("Editable vector metadata requires an SVG <path>");
  }
  const sourceKind = element.getAttribute("data-opendesign-kind");
  if (sourceKind !== "path" && sourceKind !== "vector") {
    return invalid(
      "Editable vector metadata requires an OpenDesign Path or Vector kind",
    );
  }
  if (
    !SUPPORTED_VECTOR_NETWORK_VERSIONS.has(
      element.getAttribute(VERSION_ATTRIBUTE) ?? "",
    )
  ) {
    return invalid(
      "Editable vector metadata version is missing or unsupported",
    );
  }
  const version = element.getAttribute(VERSION_ATTRIBUTE) ?? "";
  const cornerRadius = readCornerRadius(element, version);
  if (cornerRadius === null) {
    return invalid("Editable vector corner radius is missing or invalid");
  }
  const cornerSmoothing = readCornerSmoothing(element, version);
  if (cornerSmoothing === null) {
    return invalid("Editable vector corner smoothing is missing or invalid");
  }
  const source = element.getAttribute(NETWORK_ATTRIBUTE);
  if (!source || source.length > MAX_NETWORK_CHARACTERS) {
    return invalid("Editable vector metadata is missing or exceeds its limit");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return invalid("Editable vector metadata is not valid JSON");
  }
  const parsedNetwork = VectorNetworkContract.parse(parsed);
  if (!parsedNetwork.ok) {
    return invalid(
      `Editable vector metadata does not match the versioned schema: ${parsedNetwork.issues[0]?.message ?? "invalid network"}`,
    );
  }
  const network = portableVectorNetwork(parsedNetwork.value);
  const topologyIssues = validateVectorNetwork(network);
  if (topologyIssues.length > 0) {
    return invalid(
      `Editable vector metadata has invalid topology: ${topologyIssues[0]?.message ?? "invalid network"}`,
    );
  }
  const serialized = serializeVectorNetwork(
    network,
    cornerRadius,
    cornerSmoothing,
  );
  if (!serialized.ok) {
    return invalid("Editable vector metadata could not be serialized");
  }
  if (normalizePathText(serialized.path) !== normalizePathText(pathData)) {
    return invalid(
      "Editable vector metadata does not match the rendered SVG path",
    );
  }
  let fallbackFills: Paint[] = [];
  if (
    version === "3" ||
    version === "4" ||
    version === "5" ||
    version === VECTOR_NETWORK_VERSION
  ) {
    const fillsSource = element.getAttribute(FALLBACK_FILLS_ATTRIBUTE);
    if (!fillsSource)
      return invalid("Editable vector fallback fills are missing");
    if (source.length + fillsSource.length > MAX_NETWORK_CHARACTERS) {
      return invalid("Editable vector metadata exceeds its limit");
    }
    let fills: unknown;
    try {
      fills = JSON.parse(fillsSource);
    } catch {
      return invalid("Editable vector fallback fills are not valid JSON");
    }
    const parsedFills = FallbackFillsContract.parse(fills);
    if (!parsedFills.ok) {
      return invalid(
        "Editable vector fallback fills do not match the versioned schema",
      );
    }
    fallbackFills = parsedFills.value;
  }
  return {
    status: "valid",
    ...(cornerRadius > 0 ? { cornerRadius } : {}),
    ...(cornerSmoothing > 0 ? { cornerSmoothing } : {}),
    fallbackFills,
    network,
  };
}

function readCornerRadius(element: Element, version: string): number | null {
  if (version !== "5" && version !== VECTOR_NETWORK_VERSION) return 0;
  const source = element.getAttribute(CORNER_RADIUS_ATTRIBUTE);
  if (source === null || source.trim() === "") return null;
  const value = Number(source);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function readCornerSmoothing(element: Element, version: string): number | null {
  if (version !== VECTOR_NETWORK_VERSION) return 0;
  const source = element.getAttribute(CORNER_SMOOTHING_ATTRIBUTE);
  if (source === null || source.trim() === "") return null;
  const value = Number(source);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

function portableVectorNetwork(network: VectorNetwork): VectorNetwork {
  if (!network.regions.some((region) => region.fillStyleId !== undefined)) {
    return network;
  }
  const portable = structuredClone(network);
  for (const region of portable.regions) delete region.fillStyleId;
  return portable;
}

function normalizePathText(value: string): string {
  return value.trim().replace(/[\t\n\r ]+/g, " ");
}

function invalid(message: string): SvgEditableVectorReadResult {
  return { status: "invalid", message };
}
