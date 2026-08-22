import { describe, expect, it, vi } from "vitest";
import { AppNavigator } from "./app-navigator";

describe("AppNavigator", () => {
  it("commits destination and resource identity atomically", () => {
    const navigator = new AppNavigator({ kind: "workspace" });
    const transition = navigator.begin({
      kind: "project",
      projectId: "project_alpha",
    });

    expect(navigator.getSnapshot()).toEqual({
      destination: { kind: "workspace" },
      pending: transition,
    });

    expect(
      navigator.commit(transition, {
        kind: "project",
        projectId: "project_alpha",
      }),
    ).toBe(true);
    expect(navigator.getSnapshot()).toEqual({
      destination: { kind: "project", projectId: "project_alpha" },
      pending: null,
    });
  });

  it("uses latest-wins semantics for asynchronous navigation", () => {
    const navigator = new AppNavigator({ kind: "workspace" });
    const first = navigator.begin({
      kind: "project",
      projectId: "project_slow",
    });
    const second = navigator.begin({
      kind: "project",
      projectId: "project_fast",
    });

    expect(
      navigator.commit(first, {
        kind: "project",
        projectId: "project_slow",
      }),
    ).toBe(false);
    expect(
      navigator.commit(second, {
        kind: "project",
        projectId: "project_fast",
      }),
    ).toBe(true);
    expect(navigator.getSnapshot().destination).toEqual({
      kind: "project",
      projectId: "project_fast",
    });
  });

  it("publishes an explicit invalid destination only for the active request", () => {
    const navigator = new AppNavigator({ kind: "workspace" });
    const stale = navigator.begin({ kind: "editor", fileKey: "file_stale" });
    const active = navigator.begin({ kind: "editor", fileKey: "file_active" });

    expect(navigator.fail(stale, "stale failed")).toBe(false);
    expect(navigator.fail(active, "active failed")).toBe(true);
    expect(navigator.getSnapshot()).toEqual({
      destination: {
        kind: "invalid",
        reason: "active failed",
        requested: { kind: "editor", fileKey: "file_active" },
      },
      pending: null,
    });
  });

  it("returns from settings to the exact previous destination", () => {
    const navigator = new AppNavigator({
      kind: "conversation",
      conversationId: "conversation_1",
      issue: "page-unavailable",
    });

    navigator.openSettings();
    expect(navigator.getSnapshot().destination).toEqual({
      kind: "settings",
      returnTo: {
        kind: "conversation",
        conversationId: "conversation_1",
        issue: "page-unavailable",
      },
    });
    navigator.closeSettings();
    expect(navigator.getSnapshot().destination).toEqual({
      kind: "conversation",
      conversationId: "conversation_1",
      issue: "page-unavailable",
    });
  });

  it("cancels pending transitions when direct navigation wins", () => {
    const navigator = new AppNavigator({ kind: "workspace" });
    const listener = vi.fn();
    navigator.subscribe(listener);
    const transition = navigator.begin({ kind: "project" });

    navigator.navigate({ kind: "editor", fileKey: "local:file" });

    expect(navigator.isCurrent(transition)).toBe(false);
    expect(navigator.getSnapshot()).toEqual({
      destination: { kind: "editor", fileKey: "local:file" },
      pending: null,
    });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
