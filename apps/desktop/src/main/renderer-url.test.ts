import { describe, expect, it } from "vitest";
import { resolveRendererUrl } from "./renderer-url";

describe("resolveRendererUrl", () => {
  it("uses the Vite development server instead of a stale renderer build", () => {
    expect(
      resolveRendererUrl({
        VITE_DEV_SERVER_URL: "http://localhost:5173",
        ELECTRON_RENDERER_URL: "http://localhost:4173",
      }),
    ).toBe("http://localhost:5173/");
  });

  it("returns null for packaged builds", () => {
    expect(resolveRendererUrl({})).toBeNull();
  });

  it("rejects renderer URLs outside HTTP development origins", () => {
    expect(() =>
      resolveRendererUrl({ VITE_DEV_SERVER_URL: "file:///tmp/index.html" }),
    ).toThrow("Unsupported renderer protocol");
  });
});
