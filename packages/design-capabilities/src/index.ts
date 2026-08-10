import rawManifest from "./manifest.json" with { type: "json" };

export const DESIGN_CAPABILITY_MANIFEST_VERSION = 1 as const;
export const CAPABILITY_STATUSES = [
  "available",
  "degraded",
  "unavailable",
] as const;
export const CAPABILITY_SURFACES = [
  "contract",
  "runtime",
  "human",
  "agent",
  "render",
  "export",
] as const;

export type CapabilityStatus = (typeof CAPABILITY_STATUSES)[number];
export type CapabilitySurface = (typeof CAPABILITY_SURFACES)[number];
export type CapabilityLocale = "en" | "zh-CN";
export type LocalizedCapabilityText = Readonly<
  Record<CapabilityLocale, string>
>;

export type CapabilityEvidence = {
  automated: readonly string[];
  manual: readonly string[];
};

export type DesignCapability = {
  id: string;
  category: string;
  status: CapabilityStatus;
  label: LocalizedCapabilityText;
  description: LocalizedCapabilityText;
  provider: string;
  requiredSurfaces: readonly CapabilitySurface[];
  surfaces: Readonly<Record<CapabilitySurface, CapabilityStatus>>;
  limitations: readonly LocalizedCapabilityText[];
  evidence: CapabilityEvidence;
  references: readonly string[];
};

export type CapabilityCategory = {
  id: string;
  label: LocalizedCapabilityText;
};

export type DesignCapabilityManifest = {
  version: typeof DESIGN_CAPABILITY_MANIFEST_VERSION;
  updatedAt: string;
  documentSchemaVersion: string;
  engineBaseline: string;
  categories: readonly CapabilityCategory[];
  capabilities: readonly DesignCapability[];
};

const parsedManifest = parseManifest(rawManifest);

export const DESIGN_CAPABILITY_MANIFEST: DesignCapabilityManifest =
  deepFreeze(parsedManifest);

export function getDesignCapability(
  id: string,
  manifest: DesignCapabilityManifest = DESIGN_CAPABILITY_MANIFEST,
): DesignCapability | undefined {
  return manifest.capabilities.find((capability) => capability.id === id);
}

export function summarizeCapabilityStatuses(
  manifest: DesignCapabilityManifest = DESIGN_CAPABILITY_MANIFEST,
): Readonly<Record<CapabilityStatus, number>> {
  return manifest.capabilities.reduce(
    (summary, capability) => {
      summary[capability.status] += 1;
      return summary;
    },
    { available: 0, degraded: 0, unavailable: 0 },
  );
}

export function formatAgentCapabilitySummary(
  manifest: DesignCapabilityManifest = DESIGN_CAPABILITY_MANIFEST,
): string {
  const lines = [
    `Current OpenDesign design capability manifest v${manifest.version} (${manifest.updatedAt}):`,
    "Status is trusted product metadata. Do not claim a degraded capability is complete or an unavailable capability is supported.",
  ];
  for (const capability of manifest.capabilities) {
    const limitations = capability.limitations.map((item) => item.en).join(" ");
    lines.push(
      `- [${capability.status}] ${capability.id}: ${capability.description.en}${limitations ? ` Limit: ${limitations}` : ""}`,
    );
  }
  lines.push(
    "Call opendesign_get_capabilities when a request depends on exact surface status, providers, or evidence.",
  );
  return lines.join("\n");
}

export function capabilityManifestForAgent(
  manifest: DesignCapabilityManifest = DESIGN_CAPABILITY_MANIFEST,
): object {
  return {
    version: manifest.version,
    updatedAt: manifest.updatedAt,
    documentSchemaVersion: manifest.documentSchemaVersion,
    engineBaseline: manifest.engineBaseline,
    capabilities: manifest.capabilities.map((capability) => ({
      id: capability.id,
      status: capability.status,
      name: capability.label.en,
      description: capability.description.en,
      provider: capability.provider,
      surfaces: capability.surfaces,
      limitations: capability.limitations.map((item) => item.en),
      evidence: {
        automated: capability.evidence.automated.length,
        manual: capability.evidence.manual.length,
      },
    })),
  };
}

export function isDesignCapabilityManifest(
  value: unknown,
): value is DesignCapabilityManifest {
  try {
    parseManifest(value);
    return true;
  } catch {
    return false;
  }
}

function parseManifest(value: unknown): DesignCapabilityManifest {
  const manifest = record(value, "capability manifest");
  exactKeys(manifest, [
    "version",
    "updatedAt",
    "documentSchemaVersion",
    "engineBaseline",
    "categories",
    "capabilities",
  ]);
  if (manifest.version !== DESIGN_CAPABILITY_MANIFEST_VERSION) {
    throw new TypeError("Unsupported capability manifest version");
  }
  const updatedAt = nonEmptyString(manifest.updatedAt, "updatedAt");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(updatedAt)) {
    throw new TypeError("Invalid capability manifest date");
  }
  const categories = array(manifest.categories, "categories").map(
    (category, index) => parseCategory(category, index),
  );
  unique(
    categories.map((category) => category.id),
    "category ID",
  );
  const categoryIds = new Set(categories.map((category) => category.id));
  const capabilities = array(manifest.capabilities, "capabilities").map(
    (capability, index) => parseCapability(capability, index, categoryIds),
  );
  unique(
    capabilities.map((capability) => capability.id),
    "capability ID",
  );
  return {
    version: DESIGN_CAPABILITY_MANIFEST_VERSION,
    updatedAt,
    documentSchemaVersion: nonEmptyString(
      manifest.documentSchemaVersion,
      "documentSchemaVersion",
    ),
    engineBaseline: nonEmptyString(manifest.engineBaseline, "engineBaseline"),
    categories,
    capabilities,
  };
}

function parseCategory(value: unknown, index: number): CapabilityCategory {
  const category = record(value, `categories[${index}]`);
  exactKeys(category, ["id", "label"]);
  return {
    id: stableId(category.id, `categories[${index}].id`),
    label: localized(category.label, `categories[${index}].label`),
  };
}

function parseCapability(
  value: unknown,
  index: number,
  categoryIds: ReadonlySet<string>,
): DesignCapability {
  const path = `capabilities[${index}]`;
  const capability = record(value, path);
  exactKeys(capability, [
    "id",
    "category",
    "status",
    "label",
    "description",
    "provider",
    "requiredSurfaces",
    "surfaces",
    "limitations",
    "evidence",
    "references",
  ]);
  const category = stableId(capability.category, `${path}.category`);
  if (!categoryIds.has(category))
    throw new TypeError(`Unknown ${path} category`);
  const requiredSurfaces = array(
    capability.requiredSurfaces,
    `${path}.requiredSurfaces`,
  ).map((surface) => parseSurface(surface, `${path}.requiredSurfaces`));
  if (requiredSurfaces.length === 0) {
    throw new TypeError(`${path} must require at least one surface`);
  }
  unique(requiredSurfaces, `${path} required surface`);
  const surfacesRecord = record(capability.surfaces, `${path}.surfaces`);
  exactKeys(surfacesRecord, [...CAPABILITY_SURFACES]);
  const surfaces = Object.fromEntries(
    CAPABILITY_SURFACES.map((surface) => [
      surface,
      parseStatus(surfacesRecord[surface], `${path}.surfaces.${surface}`),
    ]),
  ) as Record<CapabilitySurface, CapabilityStatus>;
  const evidenceRecord = record(capability.evidence, `${path}.evidence`);
  exactKeys(evidenceRecord, ["automated", "manual"]);
  const evidence = {
    automated: stringArray(
      evidenceRecord.automated,
      `${path}.evidence.automated`,
    ),
    manual: stringArray(evidenceRecord.manual, `${path}.evidence.manual`),
  };
  const status = parseStatus(capability.status, `${path}.status`);
  const derived = deriveStatus(requiredSurfaces, surfaces, evidence);
  if (status !== derived) {
    throw new TypeError(
      `${path}.status is ${status}; expected ${derived} from surfaces and evidence`,
    );
  }
  return {
    id: stableId(capability.id, `${path}.id`),
    category,
    status,
    label: localized(capability.label, `${path}.label`),
    description: localized(capability.description, `${path}.description`),
    provider: nonEmptyString(capability.provider, `${path}.provider`),
    requiredSurfaces,
    surfaces,
    limitations: array(capability.limitations, `${path}.limitations`).map(
      (item, limitationIndex) =>
        localized(item, `${path}.limitations[${limitationIndex}]`),
    ),
    evidence,
    references: stringArray(capability.references, `${path}.references`),
  };
}

function deriveStatus(
  required: readonly CapabilitySurface[],
  surfaces: Readonly<Record<CapabilitySurface, CapabilityStatus>>,
  evidence: CapabilityEvidence,
): CapabilityStatus {
  const statuses = required.map((surface) => surfaces[surface]);
  if (statuses.every((status) => status === "unavailable")) {
    return "unavailable";
  }
  if (
    statuses.some((status) => status !== "available") ||
    evidence.automated.length === 0 ||
    evidence.manual.length === 0
  ) {
    return "degraded";
  }
  return "available";
}

function localized(value: unknown, path: string): LocalizedCapabilityText {
  const text = record(value, path);
  exactKeys(text, ["en", "zh-CN"]);
  return {
    en: nonEmptyString(text.en, `${path}.en`),
    "zh-CN": nonEmptyString(text["zh-CN"], `${path}.zh-CN`),
  };
}

function parseStatus(value: unknown, path: string): CapabilityStatus {
  if (!CAPABILITY_STATUSES.includes(value as CapabilityStatus)) {
    throw new TypeError(`Invalid ${path}`);
  }
  return value as CapabilityStatus;
}

function parseSurface(value: unknown, path: string): CapabilitySurface {
  if (!CAPABILITY_SURFACES.includes(value as CapabilitySurface)) {
    throw new TypeError(`Invalid ${path}`);
  }
  return value as CapabilitySurface;
}

function stableId(value: unknown, path: string): string {
  const id = nonEmptyString(value, path);
  if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(id)) {
    throw new TypeError(`Invalid ${path}`);
  }
  return id;
}

function stringArray(value: unknown, path: string): string[] {
  return array(value, path).map((item, index) =>
    nonEmptyString(item, `${path}[${index}]`),
  );
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`Invalid ${path}`);
  }
  return value;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`Invalid ${path}`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`Invalid ${path}`);
  return value;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  if (
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key))
  ) {
    throw new TypeError("Capability manifest contains unknown fields");
  }
}

function unique(values: readonly string[], label: string) {
  if (new Set(values).size !== values.length) {
    throw new TypeError(`Duplicate ${label}`);
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}
