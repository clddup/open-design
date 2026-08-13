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
  const constraintsChanged =
    before.constraints?.horizontal !== after.constraints?.horizontal ||
    before.constraints?.vertical !== after.constraints?.vertical;
  const layoutSizingChanged =
    before.layoutSizing?.horizontal !== after.layoutSizing?.horizontal ||
    before.layoutSizing?.vertical !== after.layoutSizing?.vertical;
  if (
    !transformChanged &&
    !sizeChanged &&
    !constraintsChanged &&
    !layoutSizingChanged
  )
    return null;
  return {
    commandId,
    type: "update_properties",
    nodeId: after.id,
    ...(transformChanged ? { transform: after.transform } : {}),
    ...(sizeChanged ? { size: after.size } : {}),
    ...(constraintsChanged ? { constraints: after.constraints ?? null } : {}),
    ...(layoutSizingChanged
      ? { layoutSizing: after.layoutSizing ?? null }
      : {}),
  };
}

function sameArray<T>(left: readonly T[], right: readonly T[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
