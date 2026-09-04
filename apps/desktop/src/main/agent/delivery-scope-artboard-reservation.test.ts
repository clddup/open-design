import { describe, expect, it } from "vitest";
import type { DesignDeliveryScope } from "@/shared/design-agent-tools.js";
import type { InspectedHierarchy } from "./design-plan-registration.js";
import { createScopeArtboardReservation } from "./delivery-scope-artboard-reservation.js";

describe("delivery scope artboard reservation", () => {
  it("reserves stable non-overlapping Frame identities without creating commands", () => {
    const inspection = inspectedPage();
    const before = structuredClone(inspection);
    const reservation = createScopeArtboardReservation(
      scope(12),
      "page_current",
      inspection,
    );

    expect(reservation.artboards).toHaveLength(12);
    expect(reservation.artboards[0]).toMatchObject({
      frameId: "run_scope_scope_1",
      x: 1760,
      y: 80,
    });
    expect(
      reservation.artboards.every((artboard) =>
        artboard.frameId.startsWith("run_scope_"),
      ),
    ).toBe(true);
    expect(hasOverlap(reservation.artboards)).toBe(false);
    expect(inspection).toEqual(before);
  });
});

function scope(count: number): DesignDeliveryScope {
  return {
    version: 1,
    deliverable: "ui",
    objective: "Design the complete product suite",
    targets: Array.from({ length: count }, (_, index) => ({
      targetId: `target_${index + 1}`,
      label: `Screen ${index + 1}`,
      objective: `Design the complete screen ${index + 1}`,
      artboard: {
        width: index % 2 === 0 ? 1440 : 1280,
        height: index % 3 === 0 ? 960 : 900,
      },
      requiredContent: [`Screen ${index + 1} content`],
    })),
    exclusions: [],
    assumptions: [],
  };
}

function inspectedPage(): InspectedHierarchy {
  return {
    catalogComponentsById: new Map(),
    componentsById: new Map(),
    documentId: "document_scope",
    newNodeIdPrefix: "run_scope_",
    nodesById: new Map([
      [
        "existing_root",
        {
          childIds: [],
          componentId: null,
          id: "existing_root",
          kind: "frame",
          locked: false,
          parentId: null,
          size: { width: 1600, height: 1000 },
          transform: [1, 0, 0, 1, 0, 80],
        },
      ],
    ]),
    pageRootsById: new Map([["page_current", new Set(["existing_root"])]]),
    revision: 4,
  };
}

function hasOverlap(
  artboards: readonly {
    x: number;
    y: number;
    width: number;
    height: number;
  }[],
): boolean {
  return artboards.some((left, index) =>
    artboards
      .slice(index + 1)
      .some(
        (right) =>
          left.x < right.x + right.width &&
          left.x + left.width > right.x &&
          left.y < right.y + right.height &&
          left.y + left.height > right.y,
      ),
  );
}
