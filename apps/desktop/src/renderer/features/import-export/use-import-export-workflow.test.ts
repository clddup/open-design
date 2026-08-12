import { act, renderHook, waitFor } from "@testing-library/react";
import {
  createWelcomeDocument,
  EditorRuntime,
} from "@opendesign/editor-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopApi } from "../../../shared/desktop-api";
import { exportDesignRaster } from "../../raster-export";
import { useImportExportWorkflow } from "./use-import-export-workflow";

vi.mock("../../raster-export", () => ({
  exportDesignRaster: vi.fn(),
  suggestRasterExportName: (name: string | undefined) => name ?? "Export",
}));

interface DesktopHarness {
  api: DesktopApi;
  exportCommand: () => void;
  reportDiagnostic: ReturnType<typeof vi.fn>;
  saveRasterFile: ReturnType<typeof vi.fn>;
}

describe("useImportExportWorkflow", () => {
  let previousDesktop: DesktopApi | undefined;

  beforeEach(() => {
    previousDesktop = window.desktop;
    vi.mocked(exportDesignRaster).mockReset();
  });

  afterEach(() => {
    window.desktop = previousDesktop;
  });

  it("uses the latest native-command format and gives JPEG an opaque background", async () => {
    const desktop = installDesktopHarness();
    vi.mocked(exportDesignRaster).mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      height: 720,
      mimeType: "image/jpeg",
      width: 1_200,
    });
    desktop.saveRasterFile.mockResolvedValue({
      name: "Welcome.jpg",
      byteSize: 3,
    });
    const runtime = new EditorRuntime(createWelcomeDocument());
    const { result } = renderHook(() =>
      useImportExportWorkflow(workflowContext(runtime)),
    );

    act(() => result.current.setExportFormat("jpeg"));
    expect(result.current.rasterExportSettings).toMatchObject({
      format: "jpeg",
      background: { mode: "color", color: "#ffffff" },
    });

    act(() => runtime.setSelection(["frame_welcome"], "frame_welcome"));
    act(() => desktop.exportCommand());

    await waitFor(() => expect(exportDesignRaster).toHaveBeenCalledOnce());
    expect(vi.mocked(exportDesignRaster).mock.calls[0]?.[1]).toMatchObject({
      pageId: "page_welcome",
      rootNodeId: "frame_welcome",
      format: "jpeg",
      background: { mode: "color", color: "#ffffff" },
    });
    await waitFor(() => expect(result.current.operation).toBeNull());
    expect(result.current.rasterFeedback).toMatchObject({
      format: "jpeg",
      width: 1_200,
      height: 720,
    });
  });

  it("keeps operations mutually exclusive and cancels when the editor loses scope", async () => {
    const desktop = installDesktopHarness();
    let signal: AbortSignal | undefined;
    vi.mocked(exportDesignRaster).mockImplementation(
      (_document, _request, operationSignal) =>
        new Promise((_resolve, reject) => {
          signal = operationSignal;
          operationSignal?.addEventListener("abort", () =>
            reject(new DOMException("cancelled", "AbortError")),
          );
        }),
    );
    const runtime = selectedRuntime();
    const { rerender, result } = renderHook(
      ({ editorActive }) =>
        useImportExportWorkflow(workflowContext(runtime, { editorActive })),
      { initialProps: { editorActive: true } },
    );

    act(() => {
      desktop.exportCommand();
      desktop.exportCommand();
    });
    await waitFor(() => expect(exportDesignRaster).toHaveBeenCalledOnce());
    expect(result.current.operation?.kind).toBe("raster-export");

    rerender({ editorActive: false });

    await waitFor(() => expect(signal?.aborted).toBe(true));
    await waitFor(() => expect(result.current.operation).toBeNull());
    expect(desktop.saveRasterFile).not.toHaveBeenCalled();
    expect(desktop.reportDiagnostic).not.toHaveBeenCalled();
  });

  it("aborts in-flight work on unmount without reporting cancellation", async () => {
    const desktop = installDesktopHarness();
    let signal: AbortSignal | undefined;
    vi.mocked(exportDesignRaster).mockImplementation(
      (_document, _request, operationSignal) =>
        new Promise((_resolve, reject) => {
          signal = operationSignal;
          operationSignal?.addEventListener("abort", () =>
            reject(new DOMException("cancelled", "AbortError")),
          );
        }),
    );
    const runtime = selectedRuntime();
    const { result, unmount } = renderHook(() =>
      useImportExportWorkflow(workflowContext(runtime)),
    );

    act(() => void result.current.exportRaster());
    await waitFor(() => expect(exportDesignRaster).toHaveBeenCalledOnce());
    unmount();

    expect(signal?.aborted).toBe(true);
    await Promise.resolve();
    expect(desktop.reportDiagnostic).not.toHaveBeenCalled();
  });

  it("reports non-cancellation failures with the active resource identity", async () => {
    const desktop = installDesktopHarness();
    vi.mocked(exportDesignRaster).mockRejectedValue(
      new Error("Encoder failed"),
    );
    const runtime = selectedRuntime();
    const setEditorError = vi.fn();
    const { result } = renderHook(() =>
      useImportExportWorkflow(workflowContext(runtime, { setEditorError })),
    );

    await act(() => result.current.exportRaster());

    expect(setEditorError).toHaveBeenCalledWith("Encoder failed");
    await waitFor(() =>
      expect(desktop.reportDiagnostic).toHaveBeenCalledWith({
        code: "raster_export_failed",
        context: {
          designFileId: "design_1",
          projectId: "project_1",
        },
        level: "error",
        message: "Encoder failed",
        presentation: "toast",
      }),
    );
    expect(result.current.operation).toBeNull();
  });
});

function selectedRuntime(): EditorRuntime {
  const runtime = new EditorRuntime(createWelcomeDocument());
  runtime.setSelection(["frame_welcome"], "frame_welcome");
  return runtime;
}

function workflowContext(
  runtime: EditorRuntime,
  overrides: {
    editorActive?: boolean;
    setEditorError?: (message: string | null) => void;
  } = {},
) {
  return {
    activeDesignFileId: "design_1",
    activePageId: "page_welcome",
    activeProjectId: "project_1",
    applyCommands: vi.fn().mockReturnValue(true),
    editorActive: overrides.editorActive ?? true,
    runtime,
    setEditorError: overrides.setEditorError ?? vi.fn(),
    showProperties: vi.fn(),
    t: ((key: string) => key) as never,
  };
}

function installDesktopHarness(): DesktopHarness {
  let exportCommand: () => void = () => undefined;
  const reportDiagnostic = vi.fn().mockResolvedValue(undefined);
  const saveRasterFile = vi.fn().mockResolvedValue(null);
  const api = {
    onImportSvgCommand: vi.fn().mockReturnValue(() => undefined),
    onExportSvgCommand: vi.fn().mockImplementation((listener: () => void) => {
      exportCommand = listener;
      return () => undefined;
    }),
    openSvgFile: vi.fn().mockResolvedValue(null),
    reportDiagnostic,
    saveRasterFile,
    saveSvgFile: vi.fn().mockResolvedValue(null),
  } as unknown as DesktopApi;
  window.desktop = api;
  return {
    api,
    exportCommand: () => exportCommand(),
    reportDiagnostic,
    saveRasterFile,
  };
}
