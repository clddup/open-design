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
    expect(summarizeCapabilityStatuses()).toEqual({
      available: 0,
      degraded: 12,
      unavailable: 7,
    });
    expect(getDesignCapability("appearance.paints-effects-masks")?.status).toBe(
      "degraded",
    );
    expect(getDesignCapability("layout.auto-layout")?.status).toBe(
      "unavailable",
    );
    expect(getDesignCapability("delivery.svg-interchange")?.status).toBe(
      "degraded",
    );
  });

  it("provides the Agent a bounded truthful summary from the same source", () => {
    const summary = formatAgentCapabilitySummary();
    expect(summary).toContain("manifest v1");
    expect(summary).toContain("[degraded] vector.path-rendering");
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
    const components: unknown = capabilityValues.find(
      (value: unknown) =>
        typeof value === "object" &&
        value !== null &&
        "id" in value &&
        value.id === "components.instances-variants",
    );
    expect(components).toMatchObject({
      id: "components.instances-variants",
      status: "unavailable",
      name: "Components, instances, and variants",
      provider: "Not implemented",
      evidence: { automated: 0, manual: 0 },
    });
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
