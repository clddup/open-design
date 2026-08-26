import { describe, expect, it, vi } from "vitest";
import type { LeaferSceneProjection } from "./mapping.js";
import {
  LayerHoverController,
  type LayerHoverChromeResource,
} from "./layer-hover-controller.js";

type Element = { id: string };

describe("LayerHoverController", () => {
  it("shows one visible unselected persistent layer", () => {
    const setup = createSetup();

    setup.controller.sync({ nodeId: "child" }, state(setup.projection, []));

    expect(setup.chrome.show).toHaveBeenCalledWith(setup.child, {
      color: "#4f7fff",
      opacity: 1,
      strokeWidth: 1,
    });
    expect(setup.chrome.target).toBe(setup.child);
    expect(setup.chrome.opacity).toBe(1);
  });

  it("resolves Component-derived hover by stable component target", () => {
    const setup = createSetup();

    setup.controller.sync(
      {
        nodeId: "instance",
        componentTarget: {
          instanceId: "instance",
          sourcePath: ["main", "child"],
        },
      },
      state(setup.projection, []),
    );

    expect(setup.componentElement).toHaveBeenCalledWith({
      instanceId: "instance",
      sourcePath: ["main", "child"],
    });
    expect(setup.chrome.target).toBe(setup.derived);
  });

  const hiddenConditions: Array<[string, HoverCondition]> = [
    ["selected", { selected: true }],
    ["drawing", { tool: "rectangle" as const }],
    ["vector editing", { vectorEditing: true }],
    ["image crop", { imageCropActive: true }],
    ["hidden ancestor", { hiddenAncestor: true }],
  ];

  it.each(hiddenConditions)("clears hover while %s", (_label, condition) => {
    const setup = createSetup();
    setup.controller.sync({ nodeId: "child" }, state(setup.projection, []));
    if (condition.hiddenAncestor) {
      setup.projection.elementsById.get("frame")!.data.visible = false;
    }

    setup.controller.sync(
      { nodeId: "child" },
      state(
        setup.projection,
        condition.selected ? [setup.child] : [],
        condition,
      ),
    );

    expect(setup.chrome.target).toBeNull();
    expect(setup.chrome.opacity).toBe(0);
    expect(setup.chrome.update).toHaveBeenCalled();
  });

  it("owns mount and terminal disposal without reviving chrome", () => {
    const setup = createSetup();
    expect(setup.chrome.mount).toHaveBeenCalledWith({
      color: "#4f7fff",
      opacity: 0,
      strokeWidth: 1,
    });

    setup.controller.dispose();
    setup.controller.dispose();
    setup.controller.sync({ nodeId: "child" }, state(setup.projection, []));

    expect(setup.chrome.dispose).toHaveBeenCalledOnce();
    expect(setup.chrome.show).not.toHaveBeenCalled();
  });
});

function createSetup() {
  const frame = { id: "frame" };
  const child = { id: "child" };
  const derived = { id: "derived" };
  const elements = new Map([
    [frame.id, frame],
    [child.id, child],
    [derived.id, derived],
  ]);
  const projection = {
    elementsById: new Map([
      ["frame", { parentId: null, data: { visible: true } }],
      ["child", { parentId: "frame", data: { visible: true } }],
      ["derived", { parentId: "frame", data: { visible: true } }],
    ]),
  } as unknown as LeaferSceneProjection;
  const chrome = new FakeChrome<Element>();
  const componentElement = vi.fn(() => derived);
  const controller = new LayerHoverController<Element>({
    createChrome: () => chrome,
    componentElement,
    element: (nodeId) => elements.get(nodeId),
    projectionId: (element) => element.id,
  });
  return { child, chrome, componentElement, controller, derived, projection };
}

function state(
  projection: LeaferSceneProjection,
  selectedElements: Element[],
  overrides: HoverCondition = {},
) {
  return {
    tool: overrides.tool ?? ("select" as const),
    vectorEditing: overrides.vectorEditing ?? false,
    imageCropActive: overrides.imageCropActive ?? false,
    projection,
    selectedElements,
  };
}

type HoverCondition = {
  selected?: boolean;
  hiddenAncestor?: boolean;
  tool?: "select" | "rectangle";
  vectorEditing?: boolean;
  imageCropActive?: boolean;
};

class FakeChrome<
  Element extends object,
> implements LayerHoverChromeResource<Element> {
  target: Element | null = null;
  opacity = 0;
  mount = vi.fn();
  show = vi.fn(
    (
      element: Element,
      style: { color: string; opacity: number; strokeWidth: number },
    ) => {
      this.target = element;
      this.opacity = style.opacity;
    },
  );
  clearTarget = vi.fn(() => {
    this.target = null;
  });
  setOpacity = vi.fn((opacity: number) => {
    this.opacity = opacity;
  });
  update = vi.fn();
  dispose = vi.fn();
}
