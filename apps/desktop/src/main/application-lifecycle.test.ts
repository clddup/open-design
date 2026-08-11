import { describe, expect, it } from "vitest";
import { ApplicationLifecycle } from "./application-lifecycle";

describe("ApplicationLifecycle", () => {
  it("keeps macOS alive after an ordinary last-window close", () => {
    const lifecycle = new ApplicationLifecycle();

    expect(lifecycle.shouldQuitAfterLastWindow("darwin")).toBe(false);
  });

  it("quits after the last window closes on Windows", () => {
    const lifecycle = new ApplicationLifecycle();

    expect(lifecycle.shouldQuitAfterLastWindow("win32")).toBe(true);
  });

  it("resumes a requested macOS application quit after Renderer autosave", () => {
    const lifecycle = new ApplicationLifecycle();
    lifecycle.markQuitRequested();

    expect(lifecycle.shouldQuitAfterLastWindow("darwin")).toBe(true);
  });
});
