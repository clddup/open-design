import { useEffect, useRef } from "react";
import type { ProjectAutosaveCoordinator } from "./project-autosave";
import type { WorkspaceRuntime } from "./workspace-runtime";
import { executeDesignToolRequest } from "./design-tool-execution";
import { captureDesignTarget } from "./design-capture";
import { reportRendererError } from "./diagnostics";

export function useRendererDesignToolHost(
  workspace: WorkspaceRuntime,
  projectAutosave: ProjectAutosaveCoordinator,
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
      ) => {
        void desktop
          .reportDesignToolProgress({
            requestId: request.requestId,
            phase,
            progress,
          })
          .catch(() => undefined);
      };
      controllers.current.set(request.requestId, controller);
      void Promise.resolve()
        .then(() => {
          const target = workspace.getRuntimeByDocumentId(
            request.context.documentId,
          );
          if (!target) {
            throw new Error(
              `Design tool document is not open: ${request.context.documentId}`,
            );
          }
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
                );
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
                return {
                  attachment: {
                    attachmentId: attachment.attachmentId,
                    name: attachment.name,
                    mimeType: attachment.mimeType,
                    byteSize: attachment.byteSize,
                  },
                  height: preview.height,
                  width: preview.width,
                };
              },
              onProgress: reportProgress,
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
                code: "design_tool_execution_failed",
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
  }, [projectAutosave, workspace]);
}
