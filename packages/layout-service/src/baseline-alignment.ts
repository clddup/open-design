export type BaselineLayoutItem = {
  baseline?: number;
  height: number;
  stretch: boolean;
};

export type BaselineMetrics = {
  extent: number;
  position: number;
};

/**
 * Resolves a shared first-line baseline for non-stretched children. Layers
 * without text metrics use their bottom edge, matching Figma's icon/text
 * baseline behavior. Counter-axis Fill overrides alignment and is pinned to
 * the track start, so stretched children do not move the shared baseline.
 */
export function resolveBaselineMetrics(
  items: readonly BaselineLayoutItem[],
): BaselineMetrics {
  const aligned = items.filter((item) => !item.stretch);
  const position = Math.max(
    0,
    ...aligned.map((item) => item.baseline ?? item.height),
  );
  const descent = Math.max(
    0,
    ...aligned.map((item) => item.height - (item.baseline ?? item.height)),
  );
  return {
    extent: Math.max(
      position + descent,
      ...items.map((item) => item.height),
      0,
    ),
    position,
  };
}

export function baselineItemOffset(
  item: BaselineLayoutItem,
  metrics: BaselineMetrics,
): number {
  return item.stretch ? 0 : metrics.position - (item.baseline ?? item.height);
}
