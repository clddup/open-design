import type { SelectionState } from "@opendesign/design-contracts";
import type {
  LeaferAutoLayoutSpacingInputRequest,
  LeaferCanvasTool,
  LeaferGridTrackInputRequest,
} from "@opendesign/leafer-engine";
import { useCallback, useEffect, useState } from "react";
import type { CanvasAutoLayoutSpacingInput } from "./components/AutoLayoutSpacingInput";
import type { CanvasGridTrackInput } from "./components/GridTrackInput";

export function useCanvasInlineEditors({
  revision,
  selection,
  tool,
}: {
  revision: number;
  selection: SelectionState;
  tool: LeaferCanvasTool;
}) {
  const [autoLayoutSpacing, setAutoLayoutSpacing] =
    useState<CanvasAutoLayoutSpacingInput | null>(null);
  const [gridTrack, setGridTrack] = useState<CanvasGridTrackInput | null>(null);

  useEffect(() => {
    if (!autoLayoutSpacing && !gridTrack) return;
    const selectedFrameId =
      selection.nodeIds.length === 1 && !selection.componentTarget
        ? selection.nodeIds[0]
        : undefined;
    if (
      tool !== "select" ||
      (autoLayoutSpacing &&
        (selectedFrameId !== autoLayoutSpacing.frameId ||
          revision !== autoLayoutSpacing.expectedRevision))
    ) {
      setAutoLayoutSpacing(null);
    }
    if (
      tool !== "select" ||
      (gridTrack &&
        (selectedFrameId !== gridTrack.frameId ||
          revision !== gridTrack.expectedRevision))
    ) {
      setGridTrack(null);
    }
  }, [autoLayoutSpacing, gridTrack, revision, selection, tool]);

  const openAutoLayoutSpacing = useCallback(
    (request: LeaferAutoLayoutSpacingInputRequest, element: HTMLElement) => {
      setGridTrack(null);
      setAutoLayoutSpacing({
        ...request,
        canvasPoint: canvasInlineInputPoint(
          request.clientPoint,
          element,
          84,
          40,
        ),
      });
    },
    [],
  );
  const openGridTrack = useCallback(
    (request: LeaferGridTrackInputRequest, element: HTMLElement) => {
      setAutoLayoutSpacing(null);
      setGridTrack({
        ...request,
        canvasPoint: canvasInlineInputPoint(
          request.clientPoint,
          element,
          160,
          40,
        ),
      });
    },
    [],
  );

  return {
    autoLayoutSpacing,
    closeAutoLayoutSpacing: () => setAutoLayoutSpacing(null),
    closeGridTrack: () => setGridTrack(null),
    gridTrack,
    openAutoLayoutSpacing,
    openGridTrack,
  };
}

function canvasInlineInputPoint(
  clientPoint: { x: number; y: number },
  element: HTMLElement,
  width: number,
  height: number,
): { x: number; y: number } {
  const bounds = element.getBoundingClientRect();
  return {
    x: clamp(clientPoint.x - bounds.left, 0, Math.max(0, bounds.width - width)),
    y: clamp(
      clientPoint.y - bounds.top,
      0,
      Math.max(0, bounds.height - height),
    ),
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
