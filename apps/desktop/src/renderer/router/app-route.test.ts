import { describe, expect, it } from "vitest";
import { appDestination, appRoute } from "./app-route";

describe("packaged application route contract", () => {
  it("round-trips stable resource identities through encoded paths", () => {
    const destination = {
      kind: "editor" as const,
      fileKey: "project:design/file",
    };
    const route = appRoute(destination);

    expect(route.to).toBe("/editor/project%3Adesign%2Ffile");
    if (typeof route.to !== "string") throw new Error("Expected string route");
    expect(appDestination(route.to, null)).toEqual(destination);
  });

  it("keeps failure details in Router state instead of the path", () => {
    const destination = {
      kind: "invalid" as const,
      reason: "Project is unavailable",
      requested: { kind: "project" as const, projectId: "project_1" },
    };
    const route = appRoute(destination);

    expect(route.to).toBe("/invalid");
    expect(appDestination("/invalid", route.state)).toEqual(destination);
  });

  it("fails closed when an invalid route carries untrusted state", () => {
    expect(appDestination("/invalid", { reason: 42 })).toMatchObject({
      kind: "invalid",
      requested: { kind: "workspace" },
    });
  });
});
