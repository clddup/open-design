import { describe, expect, it, vi } from "vitest";
import {
  exportLeaferCapture,
  type LeaferCaptureElement,
} from "./capture-export.js";

describe("Leafer review capture export", () => {
  it("does not queue a healthy capture behind a stalled surface", async () => {
    const stalled = captureElement(() => undefined);
    const pending = exportLeaferCapture(stalled, {
      height: 960,
      width: 1_280,
    });
    const healthy = captureElement((callback) => callback());

    await expect(
      exportLeaferCapture(healthy, { height: 960, width: 1_280 }),
    ).resolves.toMatchObject({
      bytes: new Uint8Array([1, 2, 3]),
      height: 320,
      mimeType: "image/jpeg",
      width: 640,
    });
    expect(stalled.syncExport.mock.calls).toHaveLength(0);
    expect(healthy.syncExport.mock.calls).toHaveLength(1);
    void pending;
  });

  it("rejects invalid synchronous JPEG output", async () => {
    const leaf = captureElement((callback) => callback());
    leaf.syncExport.mockReturnValue({
      data: Promise.resolve(new Blob()),
      height: 320,
      width: 640,
    });

    await expect(
      exportLeaferCapture(leaf, { height: 960, width: 1_280 }),
    ).rejects.toThrow("synchronous capture did not return image bytes");
  });
});

function captureElement(
  waitViewCompleted: (callback: () => void) => void,
): LeaferCaptureElement & {
  syncExport: ReturnType<typeof vi.fn>;
} {
  return {
    getBounds: vi.fn(() => ({ height: 320, width: 640 })),
    leafer: { waitViewCompleted },
    syncExport: vi.fn(() => ({
      data: "data:image/jpeg;base64,AQID",
      height: 320,
      width: 640,
    })),
    updateLayout: vi.fn(),
  };
}
