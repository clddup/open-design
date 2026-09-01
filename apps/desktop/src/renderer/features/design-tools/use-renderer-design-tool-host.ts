import { useEffect, useRef } from "react";
import { isTrustedToolFailure } from "@opendesign/agent-contracts";
import type { LeaferTextRunStyle } from "@opendesign/leafer-engine";
import type { DesignDocument } from "@opendesign/design-contracts";
import type { TextRunLayoutProvider } from "@opendesign/text-service";
import { reportRendererError } from "../diagnostics/diagnostics";
import type { ProjectAutosaveCoordinator } from "../project/project-autosave";
import type { WorkspaceRuntime } from "../../state/workspace-runtime";
import { executeDesignToolRequest } from "./design-tool-execution";
import {
  captureDesignTarget,
  DesignCaptureTimeoutError,
} from "./design-capture";

export function useRendererDesignToolHost(
  workspace: WorkspaceRuntime,
  projectAutosave: ProjectAutosaveCoordinator,
  textRunLayoutProvider?: TextRunLayoutProvider<LeaferTextRunStyle>,
  ensureTextRunFonts?: (
    document: DesignDocument,
    signal?: AbortSignal,
  ) => Promise<void>,
): void {
  const controllers = useRef(new Map<string, AbortController>());
  useEffect(() => {
    const desktop = window.desktop;
    if (
      !desktop ||
      typeof desktop.onDesignToolRequest !== "function" ||
      typeof desktop.resolveDesignToolRequest !== "function"
    ) {
      return;
    }
    const unsubscribeRequest = desktop.onDesignToolRequest((request) => {
      const controller = new AbortController();
      const toolPerformance = {
        canvasWaitCount: 0,
        canvasWaitMs: 0,
        configuredStageDelayMs: 0,
      };
      const reportProgress = (
        phase: "accepted" | "applying" | "capturing" | "persisting",
        progress: number,
        message?: string,
      ) => {
        void desktop
          .reportDesignToolProgress({
            requestId: request.requestId,
            phase,
            progress,
            ...(message ? { message } : {}),
          })
          .catch(() => undefined);
      };
      controllers.current.set(request.requestId, controller);
      void Promise.resolve()
        .then(async () => {
          const target = workspace.getRuntimeByDocumentId(
            request.context.documentId,
          );
          if (!target) {
            throw new Error(
              `Design tool document is not open: ${request.context.documentId}`,
            );
          }
          await prepareRendererTextRunFonts(
            target.runtime.getSnapshot().document,
            ensureTextRunFonts,
            controller.signal,
          );
          return executeDesignToolRequest(
            request,
            target.runtime,
            target.activePageId,
            {
              captureCanvas: async (capturedDocument) => {
                if (!request.captureTarget) {
                  throw new Error("Canvas capture target is unavailable");
                }
                const preview = await captureDesignTarget(
                  capturedDocument,
                  request.captureTarget,
                  controller.signal,
                  {
                    ...(textRunLayoutProvider ? { textRunLayoutProvider } : {}),
                    onStage: (stage) => {
                      const progress = {
                        "surface-created": 0.22,
                        "adapter-created": 0.34,
                        "scene-synced": 0.48,
                        "export-started": 0.6,
                        "export-completed": 0.76,
                      }[stage];
                      reportProgress("capturing", progress);
                    },
                  },
                );
                reportProgress("capturing", 0.82);
                const selected = await desktop.importAgentAttachments([
                  {
                    name: `OpenDesign ${request.captureTarget.kind} r${capturedDocument.revision}.jpg`,
                    bytes: preview.bytes,
                  },
                ]);
                const attachment = selected[0];
                if (
                  !attachment ||
                  !attachment.attachmentId.startsWith("image_") ||
                  attachment.mimeType !== preview.mimeType
                ) {
                  throw new Error("Canvas preview attachment import failed");
                }
                reportProgress("capturing", 0.9);
                return {
                  attachment: {
                    attachmentId: attachment.attachmentId,
                    name: attachment.name,
                    mimeType: attachment.mimeType,
                    byteSize: attachment.byteSize,
                  },
                  height: preview.height,
                  ...(preview.textLayoutQuality
                    ? { textLayoutQuality: preview.textLayoutQuality }
                    : {}),
                  width: preview.width,
                };
              },
              onProgress: reportProgress,
              ...(textRunLayoutProvider ? { textRunLayoutProvider } : {}),
              onCanvasWait: (durationMs, configuredDelayMs) => {
                toolPerformance.canvasWaitCount += 1;
                toolPerformance.canvasWaitMs += Math.max(
                  0,
                  Math.round(durationMs),
                );
                toolPerformance.configuredStageDelayMs += Math.max(
                  0,
                  Math.round(configuredDelayMs),
                );
              },
              signal: controller.signal,
            },
          ).then(async (response) => {
            if (response.ok && response.result.designRevision) {
              reportProgress("persisting", 0.95);
              await projectAutosave.flushDocument(request.context.documentId);
            }
            return { ...response, performance: toolPerformance };
          });
        })
        .then(
          (response) => desktop.resolveDesignToolRequest(response),
          (error: unknown) => {
            if (controller.signal.aborted) {
              return desktop.resolveDesignToolRequest({
                requestId: request.requestId,
                ok: false,
                performance: toolPerformance,
                error: {
                  code: "run_cancelled",
                  message: "Design tool request was cancelled",
                  retryable: false,
                  recoverable: false,
                },
              });
            }
            if (
              error instanceof Error &&
              "cause" in error &&
              isTrustedToolFailure(error.cause)
            ) {
              return desktop.resolveDesignToolRequest({
                requestId: request.requestId,
                ok: false,
                performance: toolPerformance,
                error: error.cause,
              });
            }
            const message = reportRendererError(
              "design_tool_execution_failed",
              error,
              "Design tool execution failed",
              {
                conversationId: request.context.sessionId,
                runId: request.context.runId,
                requestId: request.requestId,
                toolCallId: request.call.toolCallId,
              },
              "silent",
              "warning",
            );
            return desktop.resolveDesignToolRequest({
              requestId: request.requestId,
              ok: false,
              performance: toolPerformance,
              error: {
                code:
                  error instanceof DesignCaptureTimeoutError
                    ? "renderer_capture_timeout"
                    : "design_tool_execution_failed",
                message,
                retryable: false,
                recoverable: true,
              },
            });
          },
        )
        .finally(() => {
          if (controllers.current.get(request.requestId) === controller) {
            controllers.current.delete(request.requestId);
          }
        });
    });
    const unsubscribeCancel = desktop.onDesignToolCancel?.(({ requestId }) => {
      controllers.current.get(requestId)?.abort();
    });
    return () => {
      unsubscribeRequest();
      unsubscribeCancel?.();
      for (const controller of controllers.current.values()) controller.abort();
      controllers.current.clear();
    };
  }, [ensureTextRunFonts, projectAutosave, textRunLayoutProvider, workspace]);
}

export async function prepareRendererTextRunFonts(
  document: DesignDocument,
  ensureTextRunFonts:
    | ((document: DesignDocument, signal?: AbortSignal) => Promise<void>)
    | undefined,
  signal: AbortSignal,
): Promise<void> {
  await ensureTextRunFonts?.(document, signal);
  if (signal.aborted) {
    throw new DOMException("Design tool request was cancelled", "AbortError");
  }
}
