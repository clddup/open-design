import { describe, expect, it } from "vitest";
import { DistanceMeasurementOverlay } from "./distance-measurement-overlay.js";

describe("DistanceMeasurementOverlay", () => {
  it("keeps redlines at one screen pixel and labels at a fixed screen size", () => {
    const presentationRoot = new FakeGroup();
    const viewportRoot = new FakeGroup();
    viewportRoot.localTransform = matrix(0.5, -20, 30);
    const overlay = new DistanceMeasurementOverlay({
      layerIndex: 0,
      leafer: fakeLeafer as never,
      presentationRoot: presentationRoot as never,
      viewportRoot: viewportRoot as never,
    });

    overlay.setMeasurements([
      {
        axis: "x",
        end: { x: 100, y: 20 },
        id: "x-after",
        start: { x: 40, y: 20 },
        value: 60,
      },
    ]);

    const layer = presentationRoot.children[0] as FakeGroup;
    const path = layer.children[0] as FakeElement;
    const pill = layer.children[1] as FakeElement;
    const label = layer.children[2] as FakeElement;
    expect(path).toMatchObject({
      path: "M 40 20 L 100 20",
      stroke: "#f24822",
      strokeWidth: 2,
      visible: true,
    });
    expect(pill).toMatchObject({ height: 40, width: 52, x: 44, y: 0 });
    expect(label).toMatchObject({
      fontSize: 22,
      height: 40,
      text: "60",
      width: 52,
    });
    expect(layer.localTransform).toEqual(matrix(0.5, -20, 30));

    viewportRoot.localTransform = matrix(2, 10, 12);
    overlay.syncViewport();
    expect(path.strokeWidth).toBe(0.5);
    expect(pill).toMatchObject({ height: 10, width: 13, x: 63.5, y: 15 });
    expect(label).toMatchObject({ fontSize: 5.5, height: 10, width: 13 });
    expect(layer.localTransform).toEqual(matrix(2, 10, 12));
  });

  it("clears and disposes every non-document overlay resource", () => {
    const presentationRoot = new FakeGroup();
    const overlay = new DistanceMeasurementOverlay({
      layerIndex: 0,
      leafer: fakeLeafer as never,
      presentationRoot: presentationRoot as never,
      viewportRoot: new FakeGroup() as never,
    });
    overlay.setMeasurements([
      {
        axis: "y",
        end: { x: 20, y: 80 },
        id: "y-after",
        start: { x: 20, y: 40 },
        value: 40,
      },
    ]);

    overlay.clear();
    expect((presentationRoot.children[0] as FakeGroup).visible).toBe(false);

    overlay.dispose();
    expect(presentationRoot.children).toEqual([]);
  });
});

class FakeElement {
  parent: FakeGroup | undefined;
  localTransform = matrix(1, 0, 0);
  strokeWidth?: number;
  visible = true;
  destroyed = false;

  constructor(data: Record<string, unknown> = {}) {
    Object.assign(this, data);
  }

  set(data: Record<string, unknown>): void {
    Object.assign(this, data);
  }

  setTransform(transform: ReturnType<typeof matrix>): void {
    this.localTransform = { ...transform };
  }

  remove(): void {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter(
      (child) => child !== this,
    );
    this.parent = undefined;
  }

  destroy(): void {
    this.destroyed = true;
  }
}

class FakeGroup extends FakeElement {
  children: FakeElement[] = [];

  add(child: FakeElement): void {
    child.remove();
    child.parent = this;
    this.children.push(child);
  }

  addAt(child: FakeElement, index: number): void {
    child.remove();
    child.parent = this;
    this.children.splice(index, 0, child);
  }
}

const fakeLeafer = {
  Group: FakeGroup,
  Path: FakeElement,
  Rect: FakeElement,
  Text: FakeElement,
};

function matrix(scale: number, e: number, f: number) {
  return { a: scale, b: 0, c: 0, d: scale, e, f };
}
