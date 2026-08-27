import {
  defineContract,
  formatContractFailure,
  type ValidationIssue,
} from "@opendesign/contract-runtime";
import { Type, type Static } from "@sinclair/typebox";
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

export const CapabilityStatusSchema = Type.Union([
  Type.Literal("available"),
  Type.Literal("degraded"),
  Type.Literal("unavailable"),
]);
export const CapabilitySurfaceSchema = Type.Union([
  Type.Literal("contract"),
  Type.Literal("runtime"),
  Type.Literal("human"),
  Type.Literal("agent"),
  Type.Literal("render"),
  Type.Literal("export"),
]);
const NonBlankTextSchema = Type.String({ minLength: 1, pattern: "\\S" });
const CapabilityIdSchema = Type.String({
  minLength: 1,
  pattern: "^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$",
});

export const LocalizedCapabilityTextSchema = Type.Object(
  {
    en: NonBlankTextSchema,
    "zh-CN": NonBlankTextSchema,
  },
  { additionalProperties: false },
);

export const CapabilityEvidenceSchema = Type.Object(
  {
    automated: Type.Array(NonBlankTextSchema),
    manual: Type.Array(NonBlankTextSchema),
  },
  { additionalProperties: false },
);

const CapabilitySurfacesSchema = Type.Object(
  {
    contract: CapabilityStatusSchema,
    runtime: CapabilityStatusSchema,
    human: CapabilityStatusSchema,
    agent: CapabilityStatusSchema,
    render: CapabilityStatusSchema,
    export: CapabilityStatusSchema,
  },
  { additionalProperties: false },
);

export const DesignCapabilitySchema = Type.Object(
  {
    id: CapabilityIdSchema,
    category: CapabilityIdSchema,
    status: CapabilityStatusSchema,
    label: LocalizedCapabilityTextSchema,
    description: LocalizedCapabilityTextSchema,
    provider: NonBlankTextSchema,
    requiredSurfaces: Type.Array(CapabilitySurfaceSchema, {
      minItems: 1,
      uniqueItems: true,
    }),
    surfaces: CapabilitySurfacesSchema,
    limitations: Type.Array(LocalizedCapabilityTextSchema),
    evidence: CapabilityEvidenceSchema,
    references: Type.Array(NonBlankTextSchema),
  },
  { additionalProperties: false },
);

export const CapabilityCategorySchema = Type.Object(
  {
    id: CapabilityIdSchema,
    label: LocalizedCapabilityTextSchema,
  },
  { additionalProperties: false },
);

export const DesignCapabilityManifestSchema = Type.Object(
  {
    version: Type.Literal(DESIGN_CAPABILITY_MANIFEST_VERSION),
    updatedAt: Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
    documentSchemaVersion: NonBlankTextSchema,
    engineBaseline: NonBlankTextSchema,
    categories: Type.Array(CapabilityCategorySchema),
    capabilities: Type.Array(DesignCapabilitySchema),
  },
  { additionalProperties: false },
);

export type CapabilityStatus = Static<typeof CapabilityStatusSchema>;
export type CapabilitySurface = Static<typeof CapabilitySurfaceSchema>;
export type CapabilityLocale = "en" | "zh-CN";
export type LocalizedCapabilityText = Static<
  typeof LocalizedCapabilityTextSchema
>;
export type CapabilityEvidence = Static<typeof CapabilityEvidenceSchema>;
export type DesignCapability = Static<typeof DesignCapabilitySchema>;
export type CapabilityCategory = Static<typeof CapabilityCategorySchema>;
export type DesignCapabilityManifest = Static<
  typeof DesignCapabilityManifestSchema
>;

export const DesignCapabilityManifestContract =
  defineContract<DesignCapabilityManifest>({
    schema: DesignCapabilityManifestSchema,
    code: "design.capability_manifest_structure_invalid",
    subject: "design capability manifest",
    refine: capabilityManifestDomainIssues,
  });

const parsedManifest = DesignCapabilityManifestContract.parse(rawManifest);
if (!parsedManifest.ok) {
  throw new TypeError(
    formatContractFailure("design capability manifest", parsedManifest.issues),
  );
}

export const DESIGN_CAPABILITY_MANIFEST: DesignCapabilityManifest = deepFreeze(
  parsedManifest.value,
);

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
  return DesignCapabilityManifestContract.parse(value).ok;
}

function capabilityManifestDomainIssues(
  manifest: DesignCapabilityManifest,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const categoryIndexById = new Map<string, number>();
  manifest.categories.forEach((category, index) => {
    const existing = categoryIndexById.get(category.id);
    if (existing !== undefined) {
      issues.push(
        issue(
          "design.capability_category_duplicate",
          `/categories/${index}/id`,
          `Category ID is already used at /categories/${existing}/id`,
        ),
      );
    } else {
      categoryIndexById.set(category.id, index);
    }
  });
  issues.push(
    ...capabilityDomainIssues(manifest.capabilities, categoryIndexById),
  );
  return issues;
}

function capabilityDomainIssues(
  capabilities: readonly DesignCapability[],
  categoryIndexById: ReadonlyMap<string, number>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const capabilityIndexById = new Map<string, number>();
  capabilities.forEach((capability, index) => {
    const path = `/capabilities/${index}`;
    const existing = capabilityIndexById.get(capability.id);
    if (existing !== undefined) {
      issues.push(
        issue(
          "design.capability_id_duplicate",
          `${path}/id`,
          `Capability ID is already used at /capabilities/${existing}/id`,
        ),
      );
    } else {
      capabilityIndexById.set(capability.id, index);
    }
    if (!categoryIndexById.has(capability.category)) {
      issues.push(
        issue(
          "design.capability_category_unknown",
          `${path}/category`,
          "Capability category must reference a declared category",
        ),
      );
    }
    const derived = deriveStatus(
      capability.requiredSurfaces,
      capability.surfaces,
      capability.evidence,
    );
    if (capability.status !== derived) {
      issues.push({
        ...issue(
          "design.capability_status_inconsistent",
          `${path}/status`,
          "Capability status must be derived from required surfaces and evidence",
        ),
        expected: derived,
        actual: capability.status,
      });
    }
  });
  return issues;
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

function issue(code: string, path: string, message: string): ValidationIssue {
  return {
    code,
    path,
    message,
    recovery:
      "Correct the capability manifest source so declared product status matches its evidence.",
  };
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
