import {
  PaintSchema,
  VectorNetworkSchema,
  schemaValidationIssues,
  type Paint,
  type VectorNetwork,
} from "@opendesign/design-contracts";
import { Type } from "@sinclair/typebox";
import {
  serializeVectorNetwork,
  validateVectorNetwork,
} from "@opendesign/geometry-service/editable-vector";

const VECTOR_NETWORK_VERSION = "3";
const SUPPORTED_VECTOR_NETWORK_VERSIONS = new Set(["1", "2", "3"]);
const VERSION_ATTRIBUTE = "data-opendesign-vector-network-version";
const NETWORK_ATTRIBUTE = "data-opendesign-vector-network";
const FALLBACK_FILLS_ATTRIBUTE = "data-opendesign-vector-fallback-fills";
const MAX_NETWORK_CHARACTERS = 1_000_000;
const PaintsSchema = Type.Array(PaintSchema, { maxItems: 4_096 });

export type SvgEditableVectorReadResult =
  | { status: "absent" }
  | { status: "invalid"; message: string }
  | { status: "valid"; fallbackFills: Paint[]; network: VectorNetwork };

export function writeSvgEditableVector(
  element: Element,
  network: VectorNetwork,
  fallbackFills: readonly Paint[] = [],
): boolean {
  const serialized = JSON.stringify(network);
  const serializedFills = JSON.stringify(fallbackFills);
  if (serialized.length + serializedFills.length > MAX_NETWORK_CHARACTERS) {
    element.removeAttribute(VERSION_ATTRIBUTE);
    element.removeAttribute(NETWORK_ATTRIBUTE);
    element.removeAttribute(FALLBACK_FILLS_ATTRIBUTE);
    return false;
  }
  element.setAttribute(VERSION_ATTRIBUTE, VECTOR_NETWORK_VERSION);
  element.setAttribute(NETWORK_ATTRIBUTE, serialized);
  element.setAttribute(FALLBACK_FILLS_ATTRIBUTE, serializedFills);
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
  const schemaIssues = schemaValidationIssues(VectorNetworkSchema, parsed);
  if (schemaIssues.length > 0) {
    return invalid(
      `Editable vector metadata does not match the versioned schema: ${schemaIssues[0]?.message ?? "invalid network"}`,
    );
  }
  const network = parsed as VectorNetwork;
  const topologyIssues = validateVectorNetwork(network);
  if (topologyIssues.length > 0) {
    return invalid(
      `Editable vector metadata has invalid topology: ${topologyIssues[0]?.message ?? "invalid network"}`,
    );
  }
  const serialized = serializeVectorNetwork(network);
  if (!serialized.ok) {
    return invalid("Editable vector metadata could not be serialized");
  }
  if (normalizePathText(serialized.path) !== normalizePathText(pathData)) {
    return invalid(
      "Editable vector metadata does not match the rendered SVG path",
    );
  }
  let fallbackFills: Paint[] = [];
  if (version === VECTOR_NETWORK_VERSION) {
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
    if (schemaValidationIssues(PaintsSchema, fills).length > 0) {
      return invalid(
        "Editable vector fallback fills do not match the versioned schema",
      );
    }
    fallbackFills = fills as Paint[];
  }
  return { status: "valid", fallbackFills, network };
}

function normalizePathText(value: string): string {
  return value.trim().replace(/[\t\n\r ]+/g, " ");
}

function invalid(message: string): SvgEditableVectorReadResult {
  return { status: "invalid", message };
}
