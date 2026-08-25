export function distributeBoundedFill(
  available: number,
  children: Array<{
    id: string;
    limits?: {
      minWidth?: number;
      maxWidth?: number;
      minHeight?: number;
      maxHeight?: number;
    };
  }>,
  axis: "horizontal" | "vertical",
): Map<string, number> {
  const result = new Map<string, number>();
  const pending = children.map((child) => {
    const minimum =
      axis === "horizontal" ? child.limits?.minWidth : child.limits?.minHeight;
    const maximum =
      axis === "horizontal" ? child.limits?.maxWidth : child.limits?.maxHeight;
    return {
      id: child.id,
      minimum: minimum ?? 0,
      maximum: maximum ?? Infinity,
    };
  });
  let remaining = available;
  while (pending.length > 0) {
    const share = remaining / pending.length;
    const upperBounded = pending.filter((child) => child.maximum < share);
    if (upperBounded.length > 0) {
      for (const child of upperBounded) {
        result.set(child.id, child.maximum);
        remaining -= child.maximum;
        pending.splice(pending.indexOf(child), 1);
      }
      continue;
    }
    const lowerBounded = pending.filter((child) => child.minimum > share);
    if (lowerBounded.length > 0) {
      for (const child of lowerBounded) {
        result.set(child.id, child.minimum);
        remaining -= child.minimum;
        pending.splice(pending.indexOf(child), 1);
      }
      continue;
    }
    for (const child of pending) result.set(child.id, Math.max(0, share));
    break;
  }
  return result;
}
