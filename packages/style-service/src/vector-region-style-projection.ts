import type {
  DesignNode,
  SharedStyleDefinition,
} from "@opendesign/design-contracts";

export interface VectorRegionStyleProjectionIssue {
  code: "incompatible-reference" | "missing-style";
  message: string;
  nodeId: string;
  path: string;
  styleId: string;
}

type StyleResolver = (styleId: string) => SharedStyleDefinition | undefined;

export function vectorRegionUsesAnyStyle(node: DesignNode): boolean {
  return (
    (node.kind === "path" || node.kind === "vector") &&
    "network" in node.properties &&
    node.properties.network.regions.some(
      (region) => region.fillStyleId !== undefined,
    )
  );
}

export function materializeVectorRegionStyles(
  node: DesignNode,
  resolveStyle: StyleResolver,
): VectorRegionStyleProjectionIssue[] {
  if (
    (node.kind !== "path" && node.kind !== "vector") ||
    !("network" in node.properties)
  ) {
    return [];
  }
  const issues: VectorRegionStyleProjectionIssue[] = [];
  for (const [index, region] of node.properties.network.regions.entries()) {
    const styleId = region.fillStyleId;
    if (!styleId) continue;
    const style = resolveStyle(styleId);
    if (!style || style.styleType !== "PAINT") {
      issues.push({
        code: style ? "incompatible-reference" : "missing-style",
        path: `/nodesById/${pointer(node.id)}/properties/network/regions/${index}/fillStyleId`,
        message: style
          ? `Vector region fillStyleId cannot consume ${style.styleType} style ${styleId}`
          : `Style ${styleId} does not exist`,
        nodeId: node.id,
        styleId,
      });
      continue;
    }
    region.fills = structuredClone(style.paints);
  }
  return issues;
}

function pointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}
