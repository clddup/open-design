import { describe, expect, it } from "vitest";
import {
  CAPABILITY_SURFACES,
  DESIGN_CAPABILITY_MANIFEST,
  capabilityManifestForAgent,
  formatAgentCapabilitySummary,
  getDesignCapability,
  isDesignCapabilityManifest,
  summarizeCapabilityStatuses,
} from "./index.js";

describe("design capability manifest", () => {
  it("publishes strict, immutable, unique capability facts", () => {
    expect(isDesignCapabilityManifest(DESIGN_CAPABILITY_MANIFEST)).toBe(true);
    expect(Object.isFrozen(DESIGN_CAPABILITY_MANIFEST)).toBe(true);
    expect(Object.isFrozen(DESIGN_CAPABILITY_MANIFEST.capabilities[0])).toBe(
      true,
    );
    expect(
      new Set(
        DESIGN_CAPABILITY_MANIFEST.capabilities.map(
          (capability) => capability.id,
        ),
      ).size,
    ).toBe(DESIGN_CAPABILITY_MANIFEST.capabilities.length);
    for (const capability of DESIGN_CAPABILITY_MANIFEST.capabilities) {
      expect(Object.keys(capability.surfaces).sort()).toEqual(
        [...CAPABILITY_SURFACES].sort(),
      );
    }
  });

  it("does not mark evidence-free professional workflows available", () => {
    const statuses = summarizeCapabilityStatuses();
    expect(statuses.available).toBe(0);
    expect(statuses.degraded + statuses.unavailable).toBe(
      DESIGN_CAPABILITY_MANIFEST.capabilities.length,
    );
    expect(getDesignCapability("appearance.paints-effects-masks")?.status).toBe(
      "degraded",
    );
    expect(getDesignCapability("layout.auto-layout")?.status).toBe("degraded");
    expect(getDesignCapability("delivery.svg-interchange")?.status).toBe(
      "degraded",
    );
  });

  it("provides the Agent a bounded truthful summary from the same source", () => {
    const summary = formatAgentCapabilitySummary();
    expect(summary).toContain("manifest v1");
    expect(summary).toContain("[degraded] vector.path-rendering");
    expect(summary).toContain("[degraded] vector.regular-shapes");
    expect(summary).toContain("[degraded] vector.boolean-operations");
    expect(summary).toContain("opendesign_get_capabilities");

    const agentManifest = capabilityManifestForAgent() as {
      version?: unknown;
      capabilities?: unknown;
    };
    expect(JSON.stringify(agentManifest)).not.toContain("zh-CN");
    expect(agentManifest.version).toBe(1);
    expect(Array.isArray(agentManifest.capabilities)).toBe(true);
    if (!Array.isArray(agentManifest.capabilities)) {
      throw new Error("Expected capability array");
    }
    const capabilityValues: unknown[] = agentManifest.capabilities;
    for (const id of [
      "components.instances-variants",
      "variables.collections-modes",
      "styles.shared-local",
    ]) {
      const source = getDesignCapability(id);
      if (!source) throw new Error(`Missing source capability ${id}`);
      const projected: unknown = capabilityValues.find(
        (value: unknown) =>
          typeof value === "object" &&
          value !== null &&
          "id" in value &&
          value.id === id,
      );
      expect(projected).toMatchObject({
        id: source.id,
        status: source.status,
        name: source.label.en,
        provider: source.provider,
        evidence: {
          automated: source.evidence.automated.length,
          manual: source.evidence.manual.length,
        },
      });
    }
  });

  it("rejects unknown fields and inconsistent declared status", () => {
    expect(
      isDesignCapabilityManifest({
        ...structuredClone(DESIGN_CAPABILITY_MANIFEST),
        secret: true,
      }),
    ).toBe(false);
    const inconsistent = structuredClone(DESIGN_CAPABILITY_MANIFEST);
    inconsistent.capabilities[0]!.status = "available";
    expect(isDesignCapabilityManifest(inconsistent)).toBe(false);
  });
});
