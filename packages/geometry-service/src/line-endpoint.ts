import type {
  LineEndpoint,
  Point,
  Transform,
} from "@opendesign/design-contracts";
import type {
  VectorGeometryProvider,
  VectorGeometryResult,
  VectorStrokeCap,
  VectorStrokeJoin,
} from "./vector-path.js";

export type PaintedLineEndpoint = Exclude<LineEndpoint, "none">;

export type LineEndpointPathCommand =
  | readonly ["M" | "L", number, number]
  | readonly ["C", number, number, number, number, number, number]
  | readonly ["Z"];

export interface LineEndpointGeometry {
  readonly commands: readonly LineEndpointPathCommand[];
  readonly fill: boolean;
}

export const LINE_ENDPOINT_MARKER_VIEW_BOX = "-4 -4 8 8" as const;
export const LINE_ENDPOINT_MARKER_SIZE = 8 as const;
export const LINE_ENDPOINT_STROKE_WIDTH = 1 as const;

const CIRCLE_RADIUS = 1.65;
const CIRCLE_CONTROL = CIRCLE_RADIUS * 0.552_284_749_830_793_6;

const GEOMETRIES: Readonly<Record<PaintedLineEndpoint, LineEndpointGeometry>> =
  {
    "line-arrow": {
      commands: [
        ["M", -3, -2.25],
        ["L", 0, 0],
        ["L", -3, 2.25],
      ],
      fill: false,
    },
    "triangle-arrow": {
      commands: [["M", 0, 0], ["L", -3, -2], ["L", -3, 2], ["Z"]],
      fill: true,
    },
    "reversed-triangle-arrow": {
      commands: [["M", 0, -2], ["L", -3, 0], ["L", 0, 2], ["Z"]],
      fill: true,
    },
    circle: {
      commands: [
        ["M", CIRCLE_RADIUS, 0],
        [
          "C",
          CIRCLE_RADIUS,
          CIRCLE_CONTROL,
          CIRCLE_CONTROL,
          CIRCLE_RADIUS,
          0,
          CIRCLE_RADIUS,
        ],
        [
          "C",
          -CIRCLE_CONTROL,
          CIRCLE_RADIUS,
          -CIRCLE_RADIUS,
          CIRCLE_CONTROL,
          -CIRCLE_RADIUS,
          0,
        ],
        [
          "C",
          -CIRCLE_RADIUS,
          -CIRCLE_CONTROL,
          -CIRCLE_CONTROL,
          -CIRCLE_RADIUS,
          0,
          -CIRCLE_RADIUS,
        ],
        [
          "C",
          CIRCLE_CONTROL,
          -CIRCLE_RADIUS,
          CIRCLE_RADIUS,
          -CIRCLE_CONTROL,
          CIRCLE_RADIUS,
          0,
        ],
        ["Z"],
      ],
      fill: true,
    },
    diamond: {
      commands: [["M", 2, 0], ["L", 0, 2], ["L", -2, 0], ["L", 0, -2], ["Z"]],
      fill: true,
    },
  };

export function resolveLineEndpointGeometry(
  endpoint: PaintedLineEndpoint,
): LineEndpointGeometry {
  return GEOMETRIES[endpoint];
}

export function serializeLineEndpointPath(
  geometry: LineEndpointGeometry,
): string {
  return geometry.commands.map(serializeCommand).join("");
}

export function resolveLineEndpointVisiblePath(options: {
  endpoint: PaintedLineEndpoint;
  lineEnd: Point;
  lineStart: Point;
  position: "start" | "end";
  provider: VectorGeometryProvider;
  strokeCap: VectorStrokeCap;
  strokeJoin: VectorStrokeJoin;
  strokeWidth: number;
}): VectorGeometryResult {
  const transform = endpointTransform(options);
  if (!transform) return failure("Line endpoint requires a non-zero line");
  const definition = resolveLineEndpointGeometry(options.endpoint);
  const path = { path: serializeLineEndpointPath(definition) };
  const outline = options.provider.outlineStroke(path, {
    cap: options.strokeCap,
    join: options.strokeJoin,
    miterLimit: 4,
    width: LINE_ENDPOINT_STROKE_WIDTH,
  });
  if (!outline.ok) return outline;
  const visible = definition.fill
    ? options.provider.combine([path, outline], "union")
    : outline;
  return visible.ok ? options.provider.transform(visible, transform) : visible;
}

function endpointTransform(options: {
  lineEnd: Point;
  lineStart: Point;
  position: "start" | "end";
  strokeWidth: number;
}): Transform | null {
  const deltaX = options.lineEnd.x - options.lineStart.x;
  const deltaY = options.lineEnd.y - options.lineStart.y;
  const length = Math.hypot(deltaX, deltaY);
  if (!Number.isFinite(length) || length <= 1e-9) return null;
  if (!Number.isFinite(options.strokeWidth) || options.strokeWidth <= 0) {
    return null;
  }
  const direction = options.position === "end" ? 1 : -1;
  const x = (deltaX / length) * direction * options.strokeWidth;
  const y = (deltaY / length) * direction * options.strokeWidth;
  const origin =
    options.position === "end" ? options.lineEnd : options.lineStart;
  return [x, y, -y, x, origin.x, origin.y];
}

function formatNumber(value: number): string {
  return Number(value.toFixed(12)).toString();
}

function serializeCommand(command: LineEndpointPathCommand): string {
  switch (command[0]) {
    case "Z":
      return "Z";
    case "M":
    case "L":
      return `${command[0]}${formatNumber(command[1])} ${formatNumber(command[2])}`;
    case "C":
      return `C${[
        command[1],
        command[2],
        command[3],
        command[4],
        command[5],
        command[6],
      ]
        .map(formatNumber)
        .join(" ")}`;
  }
}

function failure(message: string): VectorGeometryResult {
  return { ok: false, code: "invalid-input", message };
}
