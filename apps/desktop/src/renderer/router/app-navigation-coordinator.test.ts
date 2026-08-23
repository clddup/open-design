import { describe, expect, it, vi } from "vitest";
import { AppNavigationCoordinator } from "./app-navigation-coordinator";

describe("application resource navigation coordinator", () => {
  it("commits a resolved resource to the Router port", () => {
    const navigate = vi.fn();
    const coordinator = createCoordinator(navigate);
    const transition = coordinator.begin({
      kind: "project",
      projectId: "project_alpha",
    });

    expect(
      coordinator.commit(transition, {
        kind: "project",
        projectId: "project_alpha",
      }),
    ).toBe(true);
    expect(navigate).toHaveBeenCalledWith({
      kind: "project",
      projectId: "project_alpha",
    });
  });

  it("rejects a slower resource open after a newer intent", () => {
    const navigate = vi.fn();
    const coordinator = createCoordinator(navigate);
    const slow = coordinator.begin({ kind: "project", projectId: "slow" });
    const fast = coordinator.begin({ kind: "project", projectId: "fast" });

    expect(
      coordinator.commit(slow, { kind: "project", projectId: "slow" }),
    ).toBe(false);
    expect(
      coordinator.commit(fast, { kind: "project", projectId: "fast" }),
    ).toBe(true);
    expect(navigate).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith({
      kind: "project",
      projectId: "fast",
    });
  });

  it("routes only the active failure to an explicit invalid destination", () => {
    const navigate = vi.fn();
    const coordinator = createCoordinator(navigate);
    const stale = coordinator.begin({ kind: "editor", fileKey: "stale" });
    const active = coordinator.begin({ kind: "editor", fileKey: "active" });

    expect(coordinator.fail(stale, "stale failed")).toBe(false);
    expect(coordinator.fail(active, "active failed")).toBe(true);
    expect(navigate).toHaveBeenCalledWith({
      kind: "invalid",
      reason: "active failed",
      requested: { kind: "editor", fileKey: "active" },
    });
  });

  it("uses Router history when closing settings", () => {
    const navigate = vi.fn();
    const back = vi.fn();
    const coordinator = new AppNavigationCoordinator({ back, navigate });

    coordinator.openSettings();
    coordinator.closeSettings();

    expect(navigate).toHaveBeenCalledWith({ kind: "settings" });
    expect(back).toHaveBeenCalledOnce();
  });
});

function createCoordinator(navigate = vi.fn()) {
  return new AppNavigationCoordinator({ back: vi.fn(), navigate });
}
