import type {
  LeaferAutoLayoutSpacingChange,
  LeaferAutoLayoutSpacingInputRequest,
} from "./types.js";

const VALUE_MAXIMUM = 1_000_000;

export function autoLayoutSpacingChangeFromInput(
  input: Pick<
    LeaferAutoLayoutSpacingInputRequest,
    "kind" | "padding" | "paddingScope"
  >,
  value: number,
): LeaferAutoLayoutSpacingChange | null {
  if (!Number.isFinite(value) || value < 0 || value > VALUE_MAXIMUM) {
    return null;
  }
  if (input.kind === "gap") return { kind: "gap", value };
  if (input.kind === "counter-gap") {
    return { kind: "counter-gap", value };
  }
  const side = input.kind.slice(
    "padding-".length,
  ) as keyof typeof input.padding;
  const padding = { ...input.padding, [side]: value };
  if (input.paddingScope === "all") {
    padding.top = value;
    padding.right = value;
    padding.bottom = value;
    padding.left = value;
  } else if (input.paddingScope === "opposite") {
    padding[oppositeSide(side)] = value;
  }
  return { kind: "padding", value: padding };
}

function oppositeSide(
  side: "top" | "right" | "bottom" | "left",
): "top" | "right" | "bottom" | "left" {
  if (side === "top") return "bottom";
  if (side === "right") return "left";
  if (side === "bottom") return "top";
  return "right";
}
