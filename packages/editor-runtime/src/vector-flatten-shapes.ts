import {
  resolveLineEndpointPoint,
  type DesignNode,
} from "@opendesign/design-contracts";
import { resolvePathPropertiesData } from "@opendesign/geometry-service/editable-vector";
import { resolveRegularShapeGeometry } from "@opendesign/geometry-service/regular-shape";

export type FlattenPathSourceNode = Extract<
  DesignNode,
  {
    kind:
      "ellipse" | "line" | "path" | "polygon" | "rectangle" | "star" | "vector";
  }
>;

export type FlattenSourceNode =
  FlattenPathSourceNode | Extract<DesignNode, { kind: "boolean" }>;

export type FlattenSourcePath =
  | { ok: true; fillRule: "evenodd" | "nonzero"; path: string }
  | { ok: false; message: string };

export function flattenSourcePath(
  node: FlattenPathSourceNode,
): FlattenSourcePath {
  if (node.kind === "path" || node.kind === "vector") {
    const path = resolvePathPropertiesData(node.properties);
    return path
      ? {
          ok: true,
          fillRule: node.properties.fillRule ?? "nonzero",
          path,
        }
      : { ok: false, message: `Vector ${node.id} is invalid` };
  }
  if (node.kind === "rectangle") {
    return {
      ok: true,
      fillRule: "nonzero",
      path: rectanglePath(
        node.size.width,
        node.size.height,
        node.properties.cornerRadius,
      ),
    };
  }
  if (node.kind === "ellipse") {
    return {
      ok: true,
      fillRule: "nonzero",
      path: ellipsePath(node.size.width, node.size.height),
    };
  }
  if (node.kind === "polygon" || node.kind === "star") {
    const geometry = resolveRegularShapeGeometry(node);
    return geometry.ok
      ? { ok: true, fillRule: "nonzero", path: geometry.path }
      : { ok: false, message: geometry.message };
  }
  if (
    node.properties.startEndpoint !== "none" ||
    node.properties.endEndpoint !== "none"
  ) {
    return {
      ok: false,
      message: `Line ${node.id} endpoint decorations require exact outline support before Flatten`,
    };
  }
  const start = resolveLineEndpointPoint(node.size, node.properties.start);
  const end = resolveLineEndpointPoint(node.size, node.properties.end);
  return {
    ok: true,
    fillRule: "nonzero",
    path: `M${number(start.x)} ${number(start.y)}L${number(end.x)} ${number(end.y)}`,
  };
}

export function sourceHasFillGeometry(node: FlattenSourceNode): boolean {
  return node.kind !== "line";
}

function rectanglePath(width: number, height: number, radius: number): string {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  if (safeRadius === 0) return `M0 0H${number(width)}V${number(height)}H0Z`;
  const right = width - safeRadius;
  const bottom = height - safeRadius;
  return [
    `M${number(safeRadius)} 0H${number(right)}`,
    `A${number(safeRadius)} ${number(safeRadius)} 0 0 1 ${number(width)} ${number(safeRadius)}`,
    `V${number(bottom)}`,
    `A${number(safeRadius)} ${number(safeRadius)} 0 0 1 ${number(right)} ${number(height)}`,
    `H${number(safeRadius)}`,
    `A${number(safeRadius)} ${number(safeRadius)} 0 0 1 0 ${number(bottom)}`,
    `V${number(safeRadius)}`,
    `A${number(safeRadius)} ${number(safeRadius)} 0 0 1 ${number(safeRadius)} 0Z`,
  ].join("");
}

function ellipsePath(width: number, height: number): string {
  const radiusX = width / 2;
  const radiusY = height / 2;
  const controlX = radiusX * 0.552_284_749_830_793_6;
  const controlY = radiusY * 0.552_284_749_830_793_6;
  return [
    `M${number(width)} ${number(radiusY)}`,
    `C${number(width)} ${number(radiusY - controlY)} ${number(radiusX + controlX)} 0 ${number(radiusX)} 0`,
    `C${number(radiusX - controlX)} 0 0 ${number(radiusY - controlY)} 0 ${number(radiusY)}`,
    `C0 ${number(radiusY + controlY)} ${number(radiusX - controlX)} ${number(height)} ${number(radiusX)} ${number(height)}`,
    `C${number(radiusX + controlX)} ${number(height)} ${number(width)} ${number(radiusY + controlY)} ${number(width)} ${number(radiusY)}Z`,
  ].join("");
}

function number(value: number): string {
  return Number(value.toFixed(12)).toString();
}
