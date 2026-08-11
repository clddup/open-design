import type { Transform } from "@opendesign/design-contracts";

const EPSILON = 0.000_001;
const PATH_NUMBER_PATTERN = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;

const TWEEN_DATA_KEYS = [
  "backgroundBlur",
  "blur",
  "cornerRadius",
  "fill",
  "fontSize",
  "fontWeight",
  "grayscale",
  "height",
  "innerRadius",
  "innerShadow",
  "letterSpacing",
  "lineHeight",
  "opacity",
  "path",
  "points",
  "rotation",
  "shadow",
  "stroke",
  "strokeWidth",
  "text",
  "textOverflow",
  "textWrap",
  "visible",
  "width",
] as const;

export interface GenerationTweenEndpoint {
  data: Readonly<Record<string, unknown>>;
  transform: Transform;
}

export interface GenerationTweenPlan {
  discreteVisualChange: boolean;
  durationMs: number;
  endsAt: number;
  from: GenerationTweenEndpoint;
  nodeId: string;
  startsAt: number;
  to: GenerationTweenEndpoint;
}

export interface GenerationTweenFrame extends GenerationTweenEndpoint {
  done: boolean;
  progress: number;
}

export interface GenerationTweenCadenceInput {
  averageFrameMs: number;
  nodeCount: number;
  visibleNodeCount: number;
}

export interface GenerationTweenCadence {
  durationMs: number;
  maximumAnimatedNodeCount: number;
  staggerMs: number;
}

export function generationTweenCadence(
  input: GenerationTweenCadenceInput,
): GenerationTweenCadence {
  const nodeCount = finiteCount(input.nodeCount);
  const visibleNodeCount = Math.min(
    nodeCount,
    finiteCount(input.visibleNodeCount),
  );
  const averageFrameMs = Number.isFinite(input.averageFrameMs)
    ? Math.max(0, input.averageFrameMs)
    : 16.67;
  if (visibleNodeCount === 0) {
    return { durationMs: 0, maximumAnimatedNodeCount: 0, staggerMs: 0 };
  }
  if (averageFrameMs >= 26) {
    return {
      durationMs: 140,
      maximumAnimatedNodeCount: 12,
      staggerMs: visibleNodeCount <= 4 ? 8 : 0,
    };
  }
  if (averageFrameMs >= 19) {
    return {
      durationMs: 180,
      maximumAnimatedNodeCount: 24,
      staggerMs: visibleNodeCount <= 8 ? 10 : 2,
    };
  }
  if (visibleNodeCount <= 4) {
    return {
      durationMs: 300,
      maximumAnimatedNodeCount: 48,
      staggerMs: 24,
    };
  }
  if (visibleNodeCount <= 16) {
    return {
      durationMs: 260,
      maximumAnimatedNodeCount: 48,
      staggerMs: 12,
    };
  }
  return {
    durationMs: 210,
    maximumAnimatedNodeCount: 32,
    staggerMs: 4,
  };
}

export function createGenerationTweenPlan(
  nodeId: string,
  from: GenerationTweenEndpoint,
  to: GenerationTweenEndpoint,
  startsAt: number,
  durationMs: number,
): GenerationTweenPlan | undefined {
  const fromData: Record<string, unknown> = {};
  const toData: Record<string, unknown> = {};
  let discreteVisualChange = false;
  let changed = !sameNumberList(from.transform, to.transform);

  for (const key of TWEEN_DATA_KEYS) {
    const before = from.data[key];
    const after = to.data[key];
    if (sameValue(before, after)) continue;
    fromData[key] = cloneValue(before);
    toData[key] = cloneValue(after);
    changed = true;
    if (!canContinuouslyInterpolate(before, after, key)) {
      discreteVisualChange = true;
    }
  }
  if (discreteVisualChange && !Object.hasOwn(toData, "opacity")) {
    fromData.opacity = finiteNumber(from.data.opacity, 1);
    toData.opacity = finiteNumber(to.data.opacity, 1);
  }
  if (!changed) return undefined;
  const normalizedStart = finiteTime(startsAt);
  const normalizedDuration = Math.max(1, finiteTime(durationMs));
  return {
    discreteVisualChange,
    durationMs: normalizedDuration,
    endsAt: normalizedStart + normalizedDuration,
    from: { data: fromData, transform: [...from.transform] },
    nodeId,
    startsAt: normalizedStart,
    to: { data: toData, transform: [...to.transform] },
  };
}

export function generationTweenFrame(
  plan: GenerationTweenPlan,
  now: number,
): GenerationTweenFrame {
  const linear =
    (finiteTime(now) - plan.startsAt) / Math.max(1, plan.durationMs);
  const progress = clamp(linear, 0, 1);
  const eased = easeInOutCubic(progress);
  const data: Record<string, unknown> = {};
  for (const key of Object.keys(plan.to.data)) {
    data[key] = interpolateVisualValue(
      plan.from.data[key],
      plan.to.data[key],
      eased,
      key,
    );
  }
  if (plan.discreteVisualChange) {
    const opacity = finiteNumber(data.opacity, 1);
    const dissolve = 0.45 + 0.55 * Math.abs(2 * progress - 1);
    data.opacity = opacity * dissolve;
  }
  return {
    data,
    done: progress >= 1,
    progress,
    transform: interpolateTransform(
      plan.from.transform,
      plan.to.transform,
      eased,
    ),
  };
}

export function interpolateTransform(
  from: Transform,
  to: Transform,
  progress: number,
): Transform {
  const start = decomposeTransform(from);
  const end = decomposeTransform(to);
  const t = clamp(progress, 0, 1);
  if (!start || !end) {
    return from.map((value, index) =>
      interpolateNumber(value, to[index] ?? value, t),
    ) as unknown as Transform;
  }
  let rotationDelta = end.rotation - start.rotation;
  while (rotationDelta > Math.PI) rotationDelta -= Math.PI * 2;
  while (rotationDelta < -Math.PI) rotationDelta += Math.PI * 2;
  return composeTransform({
    rotation: start.rotation + rotationDelta * t,
    scaleX: interpolateNumber(start.scaleX, end.scaleX, t),
    scaleY: interpolateNumber(start.scaleY, end.scaleY, t),
    skewX: interpolateNumber(start.skewX, end.skewX, t),
    translateX: interpolateNumber(start.translateX, end.translateX, t),
    translateY: interpolateNumber(start.translateY, end.translateY, t),
  });
}

export function interpolatePathData(
  from: string,
  to: string,
  progress: number,
): string | undefined {
  const start = tokenizePath(from);
  const end = tokenizePath(to);
  if (
    start.numbers.length !== end.numbers.length ||
    start.literals.length !== end.literals.length ||
    start.literals.some((literal, index) => literal !== end.literals[index])
  ) {
    return undefined;
  }
  const t = clamp(progress, 0, 1);
  let value = start.literals[0] ?? "";
  start.numbers.forEach((number, index) => {
    value += `${formatNumber(interpolateNumber(number, end.numbers[index]!, t))}${
      start.literals[index + 1] ?? ""
    }`;
  });
  return value;
}

function interpolateVisualValue(
  from: unknown,
  to: unknown,
  progress: number,
  key: string,
): unknown {
  if (typeof from === "number" && typeof to === "number") {
    return interpolateNumber(from, to, progress);
  }
  if (typeof from === "string" && typeof to === "string") {
    const fromColor = parseColor(from);
    const toColor = parseColor(to);
    if (fromColor && toColor) {
      return formatColor({
        a: interpolateNumber(fromColor.a, toColor.a, progress),
        b: interpolateNumber(fromColor.b, toColor.b, progress),
        g: interpolateNumber(fromColor.g, toColor.g, progress),
        r: interpolateNumber(fromColor.r, toColor.r, progress),
      });
    }
    if (key === "path") {
      return (
        interpolatePathData(from, to, progress) ?? (progress < 0.5 ? from : to)
      );
    }
    return progress < 0.5 ? from : to;
  }
  if (Array.isArray(from) && Array.isArray(to) && from.length === to.length) {
    return from.map((value, index) =>
      interpolateVisualValue(value, to[index], progress, key),
    );
  }
  if (isRecord(from) && isRecord(to) && sameStringSet(from, to)) {
    return Object.fromEntries(
      Object.keys(from).map((property) => [
        property,
        interpolateVisualValue(
          from[property],
          to[property],
          progress,
          property,
        ),
      ]),
    );
  }
  return cloneValue(progress < 0.5 ? from : to);
}

function canContinuouslyInterpolate(
  from: unknown,
  to: unknown,
  key: string,
): boolean {
  if (sameValue(from, to)) return true;
  if (typeof from === "number" && typeof to === "number") {
    return Number.isFinite(from) && Number.isFinite(to);
  }
  if (typeof from === "string" && typeof to === "string") {
    if (parseColor(from) && parseColor(to)) return true;
    return key === "path" && interpolatePathData(from, to, 0.5) !== undefined;
  }
  if (Array.isArray(from) && Array.isArray(to) && from.length === to.length) {
    return from.every((value, index) =>
      canContinuouslyInterpolate(value, to[index], key),
    );
  }
  if (isRecord(from) && isRecord(to) && sameStringSet(from, to)) {
    return Object.keys(from).every((property) =>
      canContinuouslyInterpolate(from[property], to[property], property),
    );
  }
  return sameValue(from, to);
}

interface DecomposedTransform {
  rotation: number;
  scaleX: number;
  scaleY: number;
  skewX: number;
  translateX: number;
  translateY: number;
}

function decomposeTransform(value: Transform): DecomposedTransform | undefined {
  const [a, b, c, d, translateX, translateY] = value;
  if (![a, b, c, d, translateX, translateY].every(Number.isFinite)) {
    return undefined;
  }
  const scaleX = Math.hypot(a, b);
  if (scaleX < EPSILON) return undefined;
  const determinant = a * d - b * c;
  const scaleY = determinant / scaleX;
  if (Math.abs(scaleY) < EPSILON) return undefined;
  return {
    rotation: Math.atan2(b, a),
    scaleX,
    scaleY,
    skewX: Math.atan2(a * c + b * d, scaleX * scaleX),
    translateX,
    translateY,
  };
}

function composeTransform(value: DecomposedTransform): Transform {
  const cosine = Math.cos(value.rotation);
  const sine = Math.sin(value.rotation);
  const tangent = Math.tan(value.skewX);
  return [
    cosine * value.scaleX,
    sine * value.scaleX,
    (cosine * tangent - sine) * value.scaleY,
    (sine * tangent + cosine) * value.scaleY,
    value.translateX,
    value.translateY,
  ].map(normalizeNumber) as unknown as Transform;
}

interface ParsedColor {
  a: number;
  b: number;
  g: number;
  r: number;
}

function parseColor(value: string): ParsedColor | undefined {
  const normalized = value.trim();
  const hex = /^#([0-9a-f]{3,8})$/i.exec(normalized)?.[1];
  if (hex) {
    const expanded =
      hex.length === 3 || hex.length === 4
        ? [...hex].map((part) => `${part}${part}`).join("")
        : hex;
    if (expanded.length !== 6 && expanded.length !== 8) return undefined;
    return {
      r: Number.parseInt(expanded.slice(0, 2), 16),
      g: Number.parseInt(expanded.slice(2, 4), 16),
      b: Number.parseInt(expanded.slice(4, 6), 16),
      a:
        expanded.length === 8
          ? Number.parseInt(expanded.slice(6, 8), 16) / 255
          : 1,
    };
  }
  const rgb =
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(
      normalized,
    );
  if (!rgb) return undefined;
  const [r, g, b, a = "1"] = rgb.slice(1);
  if (r === undefined || g === undefined || b === undefined) return undefined;
  const parsed = {
    r: Number(r),
    g: Number(g),
    b: Number(b),
    a: Number(a),
  };
  return Object.values(parsed).every(Number.isFinite) ? parsed : undefined;
}

function formatColor(color: ParsedColor): string {
  const r = Math.round(clamp(color.r, 0, 255));
  const g = Math.round(clamp(color.g, 0, 255));
  const b = Math.round(clamp(color.b, 0, 255));
  const a = formatNumber(clamp(color.a, 0, 1));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function tokenizePath(value: string): {
  literals: string[];
  numbers: number[];
} {
  const literals: string[] = [];
  const numbers: number[] = [];
  let cursor = 0;
  for (const match of value.matchAll(PATH_NUMBER_PATTERN)) {
    const index = match.index ?? cursor;
    literals.push(value.slice(cursor, index));
    numbers.push(Number(match[0]));
    cursor = index + match[0].length;
  }
  literals.push(value.slice(cursor));
  return { literals, numbers };
}

function sameStringSet(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => Object.hasOwn(right, key))
  );
}

function sameNumberList(
  left: readonly number[],
  right: readonly number[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (value, index) => Math.abs(value - (right[index] ?? 0)) < EPSILON,
    )
  );
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function cloneValue<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function interpolateNumber(from: number, to: number, progress: number): number {
  return normalizeNumber(from + (to - from) * progress);
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function finiteCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function finiteTime(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function normalizeNumber(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.abs(value) < EPSILON ? 0 : value;
}

function formatNumber(value: number): string {
  return String(Number(normalizeNumber(value).toFixed(4)));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function easeInOutCubic(value: number): number {
  const clamped = clamp(value, 0, 1);
  return clamped < 0.5
    ? 4 * clamped * clamped * clamped
    : 1 - Math.pow(-2 * clamped + 2, 3) / 2;
}
