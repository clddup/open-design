import { expect, it } from "vitest";
import { compileDesignGenerationElement } from "@/shared/design-generation-compiler";
import { agentDesignNodeIdPrefix } from "@/shared/design-id-allocation";
import {
  editDesign,
  generateDesign,
  setupDesignEditing,
} from "./design-plan-editing.integration.fixture";

it("commits the overall section layout before filling each module in separate reversible revisions", async () => {
  const fixture = await setupDesignEditing();
  try {
    await generateDesign(fixture, {
      designGeneration: {
        label: "Establish overall layout",
        elements: [0, 1, 2].map((index) => ({
          id: `module_${index}`,
          name: ["Header", "Main content", "Footer"][index],
          kind: "frame",
          x: 24,
          y: 24 + index * 184,
          width: 752,
          height: 160,
          fills: [{ type: "solid", color: "#E8EDF2", opacity: 1 }],
        })),
      },
    });
    const layout = fixture.runtime.getSnapshot().document;
    const ledger = fixture.coordinator.getDeliveryLedger(
      fixture.context.runId,
    )!;
    const artboard = layout.nodesById[ledger.targets[0].rootNodeId];
    const modules = artboard.childIds.map((id) => layout.nodesById[id]);
    expect(layout.revision).toBe(1);
    expect(modules.map((node) => node.name)).toEqual([
      "Header",
      "Main content",
      "Footer",
    ]);
    expect(
      modules.every(
        (node) => node.kind === "frame" && node.childIds.length === 0,
      ),
    ).toBe(true);
    expect(
      Object.values(layout.nodesById).every((node) => node.kind === "frame"),
    ).toBe(true);
    expect(ledger.targets[0].status).toBe("drafted");
    expect(ledger.targets[0]).not.toHaveProperty("verifiedRevision");
    expect(
      ledger.planExecution?.targets[0].steps.map((step) => step.status),
    ).toEqual(["in_progress", "pending"]);

    for (const [index, module] of modules.entries()) {
      const node = compileDesignGenerationElement({
        id: `${agentDesignNodeIdPrefix(fixture.context.runId)}content_${index}`,
        parentId: module.id,
        name: `${module.name} content`,
        kind: "rectangle",
        x: 16,
        y: 16,
        width: 120 + index * 24,
        height: 64,
        fills: [
          {
            type: "solid",
            color: ["#224466", "#337755", "#AA6633"][index],
            opacity: 1,
          },
        ],
        strokes: [],
        strokeWidth: 0,
      });
      await editDesign(fixture, [
        {
          commandId: `fill_${index}`,
          type: "insert_element",
          pageId: fixture.pageId,
          parentId: module.id,
          index: 0,
          node,
        },
      ]);
      const current = fixture.runtime.getSnapshot().document;
      expect(current.revision).toBe(index + 2);
      expect(current.nodesById[artboard.id].childIds).toEqual(
        artboard.childIds,
      );
      for (const [otherIndex, otherModule] of modules.entries()) {
        expect(current.nodesById[otherModule.id].transform).toEqual(
          otherModule.transform,
        );
        expect(current.nodesById[otherModule.id].childIds).toHaveLength(
          otherIndex <= index ? 1 : 0,
        );
      }
      expect(
        fixture.coordinator
          .getDeliveryLedger(fixture.context.runId)
          ?.planExecution?.targets[0].steps.map((step) => step.status),
      ).toEqual(["in_progress", "pending"]);
    }
    for (let index = 0; index < modules.length; index += 1)
      expect(fixture.runtime.undo().ok).toBe(true);
    expect(fixture.runtime.getSnapshot().document.nodesById).toEqual(
      layout.nodesById,
    );
    expect(fixture.runtime.undo().ok).toBe(true);
    expect(
      fixture.runtime.getSnapshot().document.pagesById[fixture.pageId]
        .rootNodeIds,
    ).toEqual([]);
  } finally {
    await fixture.dispose();
  }
});
