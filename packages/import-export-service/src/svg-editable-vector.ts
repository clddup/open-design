import {
  VectorNetworkSchema,
  schemaValidationIssues,
  type VectorNetwork,
} from "@opendesign/design-contracts";
import {
  serializeVectorNetwork,
  validateVectorNetwork,
} from "@opendesign/geometry-service/editable-vector";

const VECTOR_NETWORK_VERSION = "1";
const VERSION_ATTRIBUTE = "data-opendesign-vector-network-version";
const NETWORK_ATTRIBUTE = "data-opendesign-vector-network";
const MAX_NETWORK_CHARACTERS = 1_000_000;

export type SvgEditableVectorReadResult =
  | { status: "absent" }
  | { status: "invalid"; message: string }
  | { status: "valid"; network: VectorNetwork };

export function writeSvgEditableVector(
  element: Element,
  network: VectorNetwork,
): boolean {
  const serialized = JSON.stringify(network);
  if (serialized.length > MAX_NETWORK_CHARACTERS) return false;
  element.setAttribute(VERSION_ATTRIBUTE, VECTOR_NETWORK_VERSION);
  element.setAttribute(NETWORK_ATTRIBUTE, serialized);
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
  if (element.getAttribute(VERSION_ATTRIBUTE) !== VECTOR_NETWORK_VERSION) {
    return invalid(
      "Editable vector metadata version is missing or unsupported",
    );
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
  return { status: "valid", network };
}

function normalizePathText(value: string): string {
  return value.trim().replace(/[\t\n\r ]+/g, " ");
}

function invalid(message: string): SvgEditableVectorReadResult {
  return { status: "invalid", message };
}
