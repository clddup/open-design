import { RASTER_EXPORT_VERSION } from "@opendesign/import-export-service/raster";
import type {
  DesignOperation,
  ExportSetting,
} from "@opendesign/design-contracts";
import { planStoredExportSetting } from "@opendesign/import-export-service/stored-export";
import type { EditorRuntime } from "@opendesign/editor-runtime";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  MessageKey,
  MessageParameters,
} from "../../../shared/i18n/messages";
import type { SvgWorkerExportSettings } from "../../svg-interchange-contract";
import {
  captureSvgImportTarget,
  normalizeSvgExportRoots,
  planHumanSvgImport,
  runSvgExportInWorker,
  runSvgImportInWorker,
  suggestSvgExportName,
} from "../../svg-interchange";
import {
  exportDesignRaster,
  suggestRasterExportName,
} from "../../raster-export";
import { isAbortError, reportRendererError } from "../../diagnostics";
import type {
  ExportFormat,
  RasterExportFeedback,
  RasterExportSettings,
  SvgInterchangeFeedback,
  SvgOperationStatus,
} from "./types";

type Translate = (key: MessageKey, parameters?: MessageParameters) => string;

export interface ImportExportWorkflowContext {
  activeDesignFileId: string;
  activePageId: string;
  activeProjectId: string;
  applyCommands: (label: string, commands: DesignOperation[]) => boolean;
  editorActive: boolean;
  runtime: EditorRuntime;
  setEditorError: (message: string | null) => void;
  showProperties: () => void;
  t: Translate;
}

export interface ImportExportWorkflow {
  cancelOperation: () => void;
  dismissRasterFeedback: () => void;
  dismissSvgFeedback: () => void;
  exportFormat: ExportFormat;
  exportRaster: () => Promise<void>;
  exportStoredSetting: (setting: ExportSetting) => Promise<void>;
  exportSelection: () => Promise<void>;
  exportSvg: () => Promise<void>;
  importSvg: () => Promise<void>;
  operation: SvgOperationStatus | null;
  rasterExportSettings: RasterExportSettings;
  rasterFeedback: RasterExportFeedback | null;
  setExportFormat: (format: ExportFormat) => void;
  setRasterExportSettings: (settings: RasterExportSettings) => void;
  setSvgExportSettings: (settings: SvgWorkerExportSettings) => void;
  svgExportSettings: SvgWorkerExportSettings;
  svgFeedback: SvgInterchangeFeedback | null;
}

const INITIAL_RASTER_EXPORT_SETTINGS: RasterExportSettings = {
  format: "png",
  size: { mode: "scale", value: 1 },
  background: { mode: "transparent" },
  quality: 0.9,
  resampling: "smooth",
};

const INITIAL_SVG_EXPORT_SETTINGS: SvgWorkerExportSettings = {
  includeLayerIds: false,
  padding: 0,
};

export function useImportExportWorkflow({
  activeDesignFileId,
  activePageId,
  activeProjectId,
  applyCommands,
  editorActive,
  runtime,
  setEditorError,
  showProperties,
  t,
}: ImportExportWorkflowContext): ImportExportWorkflow {
  const [svgExportSettings, setSvgExportSettings] =
    useState<SvgWorkerExportSettings>(INITIAL_SVG_EXPORT_SETTINGS);
  const [exportFormat, setExportFormatState] = useState<ExportFormat>("png");
  const [rasterExportSettings, setRasterExportSettings] =
    useState<RasterExportSettings>(INITIAL_RASTER_EXPORT_SETTINGS);
  const [operation, setOperation] = useState<SvgOperationStatus | null>(null);
  const [svgFeedback, setSvgFeedback] = useState<SvgInterchangeFeedback | null>(
    null,
  );
  const [rasterFeedback, setRasterFeedback] =
    useState<RasterExportFeedback | null>(null);
  const operationController = useRef<AbortController | null>(null);
  const latest = useRef({
    activeDesignFileId,
    activePageId,
    activeProjectId,
    applyCommands,
    editorActive,
    exportFormat,
    rasterExportSettings,
    runtime,
    setEditorError,
    showProperties,
    svgExportSettings,
    t,
  });
  latest.current = {
    activeDesignFileId,
    activePageId,
    activeProjectId,
    applyCommands,
    editorActive,
    exportFormat,
    rasterExportSettings,
    runtime,
    setEditorError,
    showProperties,
    svgExportSettings,
    t,
  };

  const beginOperation = useCallback((status: SvgOperationStatus) => {
    if (operationController.current) return null;
    const controller = new AbortController();
    operationController.current = controller;
    setOperation(status);
    setSvgFeedback(null);
    setRasterFeedback(null);
    latest.current.setEditorError(null);
    latest.current.showProperties();
    return controller;
  }, []);

  const finishOperation = useCallback((controller: AbortController) => {
    if (operationController.current !== controller) return;
    operationController.current = null;
    setOperation(null);
  }, []);

  const importSvg = useCallback(async () => {
    const current = latest.current;
    const desktop = window.desktop;
    if (!desktop || !current.editorActive || operationController.current)
      return;
    const frozen = current.runtime.getSnapshot();
    let target;
    try {
      target = captureSvgImportTarget(
        frozen.document,
        current.activePageId,
        frozen.state.selection.nodeIds,
        frozen.state.viewport,
      );
    } catch (error) {
      current.setEditorError(
        reportWorkflowError(
          "svg_import_target_invalid",
          error,
          current.t("error.importSvg"),
          current,
        ),
      );
      return;
    }
    const controller = beginOperation({ kind: "import", name: "SVG" });
    if (!controller) return;
    try {
      const file = await desktop.openSvgFile();
      if (!file || controller.signal.aborted) return;
      setOperation({ kind: "import", name: file.name });
      const operationId = `svg_${crypto.randomUUID().replaceAll("-", "")}`;
      const imported = await runSvgImportInWorker(
        {
          svg: file.contents,
          idPrefix: operationId,
          name: file.name,
        },
        controller.signal,
      );
      const document = current.runtime.getSnapshot().document;
      const plan = planHumanSvgImport(document, imported, target, operationId);
      if (!plan.ok) throw new Error(plan.message);
      if (
        !current.applyCommands(
          current.t("history.importSvg", { name: file.name }),
          plan.commands,
        )
      ) {
        return;
      }
      current.runtime.setSelection([plan.rootNodeId], plan.rootNodeId);
      setSvgFeedback({
        kind: "import",
        name: file.name,
        issues: imported.issues.map((issue) => ({ ...issue })),
      });
    } catch (error) {
      if (!isAbortError(error)) {
        current.setEditorError(
          reportWorkflowError(
            "svg_import_failed",
            error,
            current.t("error.importSvg"),
            current,
          ),
        );
      }
    } finally {
      finishOperation(controller);
    }
  }, [beginOperation, finishOperation]);

  const exportSvg = useCallback(
    async (stored?: { includeLayerIds: boolean; suffix: string }) => {
      const current = latest.current;
      const desktop = window.desktop;
      if (!desktop || !current.editorActive || operationController.current)
        return;
      const frozen = current.runtime.getSnapshot();
      if (frozen.state.selection.nodeIds.length === 0) {
        current.showProperties();
        current.setEditorError(current.t("error.exportSvgSelection"));
        return;
      }
      let rootNodeIds: string[];
      let suggestedName: string;
      try {
        rootNodeIds = normalizeSvgExportRoots(
          frozen.document,
          frozen.state.selection.nodeIds,
        );
        suggestedName = suggestSvgExportName(
          frozen.document,
          current.activePageId,
          rootNodeIds,
        );
        if (stored?.suffix) {
          suggestedName = suggestRasterExportName(
            `${suggestedName}${stored.suffix}`,
          );
        }
      } catch (error) {
        current.setEditorError(
          reportWorkflowError(
            "svg_export_target_invalid",
            error,
            current.t("error.exportSvg"),
            current,
          ),
        );
        return;
      }
      const controller = beginOperation({
        kind: "export",
        name: suggestedName,
      });
      if (!controller) return;
      try {
        const result = await runSvgExportInWorker(
          {
            document: frozen.document,
            pageId: current.activePageId,
            rootNodeIds,
            settings: stored
              ? { includeLayerIds: stored.includeLayerIds, padding: 0 }
              : { ...current.svgExportSettings },
          },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        const saved = await desktop.saveSvgFile({
          suggestedName,
          contents: result.svg,
        });
        if (!saved || controller.signal.aborted) return;
        setSvgFeedback({
          kind: "export",
          name: saved.name,
          issues: result.issues.map((issue) => ({ ...issue })),
        });
      } catch (error) {
        if (!isAbortError(error)) {
          current.setEditorError(
            reportWorkflowError(
              "svg_export_failed",
              error,
              current.t("error.exportSvg"),
              current,
            ),
          );
        }
      } finally {
        finishOperation(controller);
      }
    },
    [beginOperation, finishOperation],
  );

  const exportRaster = useCallback(
    async (stored?: {
      format: RasterExportSettings["format"];
      size: RasterExportSettings["size"];
      suffix: string;
    }) => {
      const current = latest.current;
      const desktop = window.desktop;
      if (!desktop || !current.editorActive || operationController.current)
        return;
      const frozen = current.runtime.getSnapshot();
      if (frozen.state.selection.nodeIds.length !== 1) {
        current.showProperties();
        current.setEditorError(current.t("error.exportRasterSelection"));
        return;
      }
      const rootNodeId = frozen.state.selection.nodeIds[0];
      const node = rootNodeId
        ? frozen.document.nodesById[rootNodeId]
        : undefined;
      if (!rootNodeId || !node) {
        current.setEditorError(current.t("error.exportRasterSelection"));
        return;
      }
      const settings = stored
        ? {
            format: stored.format,
            size: stored.size,
            background:
              stored.format === "jpeg"
                ? ({ mode: "color", color: "#ffffff" } as const)
                : ({ mode: "transparent" } as const),
            quality: 0.9,
            resampling: "smooth" as const,
          }
        : current.rasterExportSettings;
      const background =
        settings.format === "jpeg" && settings.background.mode === "transparent"
          ? ({ mode: "color", color: "#ffffff" } as const)
          : settings.background;
      const suggestedName = suggestRasterExportName(
        `${node.name}${stored?.suffix ?? ""}`,
      );
      const controller = beginOperation({
        kind: "raster-export",
        name: suggestedName,
      });
      if (!controller) return;
      try {
        const result = await exportDesignRaster(
          frozen.document,
          {
            version: RASTER_EXPORT_VERSION,
            pageId: current.activePageId,
            rootNodeId,
            format: settings.format,
            size: settings.size,
            background,
            ...(settings.format === "png" ? {} : { quality: settings.quality }),
            resampling: settings.resampling,
          },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        const saved = await desktop.saveRasterFile({
          suggestedName,
          format: settings.format,
          mimeType: result.mimeType,
          bytes: result.bytes,
          width: result.width,
          height: result.height,
        });
        if (!saved || controller.signal.aborted) return;
        setRasterFeedback({
          name: saved.name,
          format: settings.format,
          width: result.width,
          height: result.height,
          byteSize: saved.byteSize,
        });
      } catch (error) {
        if (!isAbortError(error)) {
          current.setEditorError(
            reportWorkflowError(
              "raster_export_failed",
              error,
              current.t("error.exportRaster"),
              current,
            ),
          );
        }
      } finally {
        finishOperation(controller);
      }
    },
    [beginOperation, finishOperation],
  );

  const exportStoredSetting = useCallback(
    async (setting: ExportSetting) => {
      const current = latest.current;
      const frozen = current.runtime.getSnapshot();
      const nodeId = frozen.state.selection.nodeIds[0];
      const node = nodeId ? frozen.document.nodesById[nodeId] : undefined;
      if (frozen.state.selection.nodeIds.length !== 1 || !node) {
        current.setEditorError(current.t("error.exportRasterSelection"));
        return;
      }
      const plan = planStoredExportSetting(node, setting);
      if (!plan.ok) {
        current.setEditorError(plan.message);
        return;
      }
      if (plan.kind === "raster") {
        await exportRaster({
          format: plan.format,
          size: plan.size,
          suffix: plan.suffix,
        });
        return;
      }
      await exportSvg({
        includeLayerIds: plan.includeLayerIds,
        suffix: plan.suffix,
      });
    },
    [exportRaster, exportSvg],
  );

  const exportSelection = useCallback(async () => {
    if (latest.current.exportFormat === "svg") return await exportSvg();
    return await exportRaster();
  }, [exportRaster, exportSvg]);

  useEffect(() => {
    const desktop = window.desktop;
    if (!desktop) return;
    const unsubscribeImport = desktop.onImportSvgCommand(() => {
      void importSvg();
    });
    const unsubscribeExport = desktop.onExportSvgCommand(() => {
      void exportSelection();
    });
    return () => {
      unsubscribeImport();
      unsubscribeExport();
    };
  }, [exportSelection, importSvg]);

  useEffect(() => {
    if (!editorActive) operationController.current?.abort();
  }, [editorActive]);

  useEffect(
    () => () => {
      operationController.current?.abort();
    },
    [],
  );

  const setExportFormat = useCallback((format: ExportFormat) => {
    setExportFormatState(format);
    if (format === "svg") return;
    setRasterExportSettings((current) => ({
      ...current,
      format,
      ...(format === "jpeg" && current.background.mode === "transparent"
        ? { background: { mode: "color", color: "#ffffff" } }
        : {}),
    }));
  }, []);

  return {
    cancelOperation: () => operationController.current?.abort(),
    dismissRasterFeedback: () => setRasterFeedback(null),
    dismissSvgFeedback: () => setSvgFeedback(null),
    exportFormat,
    exportRaster,
    exportStoredSetting,
    exportSelection,
    exportSvg,
    importSvg,
    operation,
    rasterExportSettings,
    rasterFeedback,
    setExportFormat,
    setRasterExportSettings,
    setSvgExportSettings,
    svgExportSettings,
    svgFeedback,
  };
}

function reportWorkflowError(
  code: string,
  error: unknown,
  fallback: string,
  context: Pick<
    ImportExportWorkflowContext,
    "activeProjectId" | "activeDesignFileId"
  >,
): string {
  return reportRendererError(code, error, fallback, {
    projectId: context.activeProjectId,
    designFileId: context.activeDesignFileId,
  });
}
