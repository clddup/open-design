import type {
  DesignNode,
  UpdatePropertiesCommand,
} from "@opendesign/design-contracts";

export function nodeGeometryUpdate(
  before: DesignNode,
  after: DesignNode,
  commandId: string,
): UpdatePropertiesCommand | null {
  const transformChanged = !sameArray(before.transform, after.transform);
  const sizeChanged =
    before.size.width !== after.size.width ||
    before.size.height !== after.size.height;
  const rotationOriginChanged =
    before.rotationOrigin?.x !== after.rotationOrigin?.x ||
    before.rotationOrigin?.y !== after.rotationOrigin?.y;
  const constraintsChanged =
    before.constraints?.horizontal !== after.constraints?.horizontal ||
    before.constraints?.vertical !== after.constraints?.vertical;
  const layoutPositioningChanged =
    before.layoutPositioning !== after.layoutPositioning;
  const layoutSizingChanged =
    before.layoutSizing?.horizontal !== after.layoutSizing?.horizontal ||
    before.layoutSizing?.vertical !== after.layoutSizing?.vertical;
  const layoutLimitsChanged =
    JSON.stringify(before.layoutLimits) !== JSON.stringify(after.layoutLimits);
  const gridPlacementChanged =
    JSON.stringify(before.gridPlacement) !==
    JSON.stringify(after.gridPlacement);
  if (
    !transformChanged &&
    !sizeChanged &&
    !rotationOriginChanged &&
    !constraintsChanged &&
    !layoutPositioningChanged &&
    !layoutSizingChanged &&
    !layoutLimitsChanged &&
    !gridPlacementChanged
  )
    return null;
  return {
    commandId,
    type: "update_properties",
    nodeId: after.id,
    ...(transformChanged ? { transform: after.transform } : {}),
    ...(sizeChanged ? { size: after.size } : {}),
    ...(rotationOriginChanged
      ? { rotationOrigin: after.rotationOrigin ?? null }
      : {}),
    ...(constraintsChanged ? { constraints: after.constraints ?? null } : {}),
    ...(layoutPositioningChanged
      ? { layoutPositioning: after.layoutPositioning ?? null }
      : {}),
    ...(layoutSizingChanged
      ? { layoutSizing: after.layoutSizing ?? null }
      : {}),
    ...(layoutLimitsChanged
      ? { layoutLimits: after.layoutLimits ?? null }
      : {}),
    ...(gridPlacementChanged
      ? { gridPlacement: after.gridPlacement ?? null }
      : {}),
  };
}

function sameArray<T>(left: readonly T[], right: readonly T[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
