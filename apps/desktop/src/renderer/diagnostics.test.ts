import { describe, expect, it, vi } from "vitest";
import {
  isAbortError,
  rendererErrorMessage,
  reportRendererError,
} from "./diagnostics";

describe("renderer diagnostics", () => {
  it("keeps user-actionable messages and hides persistence internals", () => {
    expect(
      rendererErrorMessage(
        new Error(
          "Error invoking remote method 'project:save': Error: Disk is read-only",
        ),
        "Save failed",
      ),
    ).toBe("Disk is read-only");
    expect(
      rendererErrorMessage(
        new Error("SQLITE_CONSTRAINT: FOREIGN KEY constraint failed"),
        "Save failed",
      ),
    ).toBe("Save failed");
  });

  it("recognizes cancellation and reports structured context through preload", async () => {
    const reportDiagnostic = vi.fn().mockResolvedValue(undefined);
    const previous = window.desktop;
    window.desktop = {
      reportDiagnostic,
    } as unknown as NonNullable<typeof window.desktop>;

    expect(isAbortError(new DOMException("cancelled", "AbortError"))).toBe(
      true,
    );
    expect(isAbortError(new Error("failed"))).toBe(false);
    expect(
      reportRendererError("export_failed", new Error("No space"), "Failed", {
        projectId: "project_1",
      }),
    ).toBe("No space");
    await vi.waitFor(() => expect(reportDiagnostic).toHaveBeenCalledOnce());
    expect(reportDiagnostic).toHaveBeenCalledWith({
      code: "export_failed",
      context: { projectId: "project_1" },
      level: "error",
      message: "No space",
      presentation: "toast",
    });
    window.desktop = previous;
  });
});
