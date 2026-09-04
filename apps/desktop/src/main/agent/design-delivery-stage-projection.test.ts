import { describe, expect, it } from "vitest";
import type { DesignDeliveryScope } from "@/shared/design-agent-tools.js";
import { projectDesignDeliveryStage } from "./design-delivery-stage-projection.js";

describe("design delivery stage projection", () => {
  it("exposes the host-reserved artboard before any empty Frame is written", () => {
    const scope: DesignDeliveryScope = {
      version: 1,
      deliverable: "ui",
      objective: "Design the complete product",
      targets: [
        {
          targetId: "home",
          label: "Home",
          objective: "Design the complete Home screen",
          artboard: { width: 1440, height: 900 },
          requiredContent: ["Primary content"],
        },
      ],
      exclusions: [],
      assumptions: [],
    };

    expect(
      projectDesignDeliveryStage(
        undefined,
        scope,
        new Map([
          [
            "home",
            {
              targetId: "home",
              label: "Home",
              pageId: "page_1",
              frameId: "run_scope_scope_1",
              x: 1600,
              y: 0,
              width: 1440,
              height: 900,
            },
          ],
        ]),
      ),
    ).toEqual({
      totalTargets: 1,
      plannedTargets: 0,
      verifiedTargets: 0,
      nextTarget: {
        stage: 1,
        targetId: "home",
        label: "Home",
        objective: "Design the complete Home screen",
        requiredContent: ["Primary content"],
        artboard: {
          pageId: "page_1",
          frameId: "run_scope_scope_1",
          x: 1600,
          y: 0,
          width: 1440,
          height: 900,
        },
      },
    });
  });
});
