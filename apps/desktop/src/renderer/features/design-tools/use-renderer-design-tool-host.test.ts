import { createEmptyDesignDocument } from "@opendesign/editor-runtime";
import { describe, expect, it, vi } from "vitest";
import { prepareRendererTextRunFonts } from "./use-renderer-design-tool-host";

describe("renderer design tool font readiness", () => {
  it("waits for exact document fonts before design execution continues", async () => {
    const document = createEmptyDesignDocument("document_1", "page_1");
    let release!: () => void;
    const ensure = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const pending = prepareRendererTextRunFonts(
      document,
      ensure,
      new AbortController().signal,
    );

    expect(ensure).toHaveBeenCalledWith(document, expect.any(AbortSignal));
    let completed = false;
    void pending.then(() => {
      completed = true;
    });
    await Promise.resolve();
    expect(completed).toBe(false);
    release();
    await expect(pending).resolves.toBeUndefined();
  });

  it("does not execute after cancellation during font hydration", async () => {
    const controller = new AbortController();
    const ensure = vi.fn(() => {
      controller.abort();
      return Promise.resolve();
    });

    await expect(
      prepareRendererTextRunFonts(
        createEmptyDesignDocument("document_1", "page_1"),
        ensure,
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
