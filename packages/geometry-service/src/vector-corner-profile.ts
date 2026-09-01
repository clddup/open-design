import type { Point } from "@opendesign/design-contracts";

const EPSILON = 1e-9;

export type CornerProfileSegment = {
  controlEnd: Point;
  controlStart: Point;
  end: Point;
  role: "arc" | "circular" | "ramp-in" | "ramp-out";
  start: Point;
};

export type VectorCornerProfile = {
  entry: Point;
  exit: Point;
  segments: CornerProfileSegment[];
};

/**
 * Implements Figma's published smoothing construction: p=(1+ξ)q, two cubic
 * curvature ramps, and a fixed-center circular middle section. If an edge
 * budget is exhausted, smoothing is reduced before the circular radius.
 */
export function createVectorCornerProfile(
  vertex: Point,
  previous: Point,
  next: Point,
  radius: number,
  smoothing: number,
): VectorCornerProfile | null {
  const incoming = normalize(subtract(vertex, previous));
  const outgoing = normalize(subtract(next, vertex));
  if (!incoming || !outgoing) return null;
  const turn = Math.atan2(cross(incoming, outgoing), dot(incoming, outgoing));
  const magnitude = Math.abs(turn);
  if (magnitude <= EPSILON || Math.PI - magnitude <= EPSILON) return null;
  const radiusFactor = Math.tan(magnitude / 2);
  if (!Number.isFinite(radiusFactor) || radiusFactor <= EPSILON) return null;
  const maximumDistance = Math.min(
    distance(previous, vertex) / 2,
    distance(vertex, next) / 2,
  );
  const circularDistance = Math.min(radius * radiusFactor, maximumDistance);
  if (circularDistance <= EPSILON) return null;
  const effectiveRadius = circularDistance / radiusFactor;
  const effectiveSmoothing = Math.min(
    smoothing,
    Math.max(0, maximumDistance / circularDistance - 1),
  );
  const consumedDistance = circularDistance * (1 + effectiveSmoothing);
  const entry = subtract(vertex, scale(incoming, consumedDistance));
  const exit = add(vertex, scale(outgoing, consumedDistance));
  return effectiveSmoothing <= EPSILON
    ? circularProfile(
        entry,
        exit,
        incoming,
        outgoing,
        magnitude,
        effectiveRadius,
      )
    : smoothedProfile({
        circularDistance,
        entry,
        exit,
        incoming,
        magnitude,
        outgoing,
        radius: effectiveRadius,
        smoothing: effectiveSmoothing,
        turnSign: Math.sign(turn),
      });
}

function circularProfile(
  entry: Point,
  exit: Point,
  incoming: Point,
  outgoing: Point,
  magnitude: number,
  radius: number,
): VectorCornerProfile {
  const controlDistance = (4 / 3) * Math.tan(magnitude / 4) * radius;
  return {
    entry,
    exit,
    segments: [
      {
        controlEnd: subtract(exit, scale(outgoing, controlDistance)),
        controlStart: add(entry, scale(incoming, controlDistance)),
        end: exit,
        role: "circular",
        start: entry,
      },
    ],
  };
}

type SmoothedProfileInput = {
  circularDistance: number;
  entry: Point;
  exit: Point;
  incoming: Point;
  magnitude: number;
  outgoing: Point;
  radius: number;
  smoothing: number;
  turnSign: number;
};

function smoothedProfile(input: SmoothedProfileInput): VectorCornerProfile {
  const rampAngle = (input.magnitude * input.smoothing) / 2;
  const rise = input.radius * (1 - Math.cos(rampAngle));
  const advance = input.radius * Math.sin(rampAngle);
  const consumedDistance = input.circularDistance * (1 + input.smoothing);
  const rampAdvance = consumedDistance - input.circularDistance + advance;
  const circleStart = add(
    add(input.entry, scale(input.incoming, rampAdvance)),
    scale(rotateQuarter(input.incoming, input.turnSign), rise),
  );
  const circleEnd = add(
    subtract(input.exit, scale(input.outgoing, rampAdvance)),
    scale(rotateQuarter(input.outgoing, input.turnSign), rise),
  );
  const tangentHorizontal = rise / Math.tan(rampAngle);
  const controlStep = Math.max(0, (rampAdvance - tangentHorizontal) / 3);
  const segments: CornerProfileSegment[] = [
    {
      controlEnd: add(input.entry, scale(input.incoming, controlStep * 3)),
      controlStart: add(input.entry, scale(input.incoming, controlStep * 2)),
      end: circleStart,
      role: "ramp-in",
      start: input.entry,
    },
  ];
  const centralAngle = input.magnitude * (1 - input.smoothing);
  if (centralAngle > EPSILON) {
    const controlDistance = (4 / 3) * Math.tan(centralAngle / 4) * input.radius;
    segments.push({
      controlEnd: subtract(
        circleEnd,
        scale(
          rotate(input.outgoing, -input.turnSign * rampAngle),
          controlDistance,
        ),
      ),
      controlStart: add(
        circleStart,
        scale(
          rotate(input.incoming, input.turnSign * rampAngle),
          controlDistance,
        ),
      ),
      end: circleEnd,
      role: "arc",
      start: circleStart,
    });
  }
  segments.push({
    controlEnd: subtract(input.exit, scale(input.outgoing, controlStep * 2)),
    controlStart: subtract(input.exit, scale(input.outgoing, controlStep * 3)),
    end: input.exit,
    role: "ramp-out",
    start: centralAngle <= EPSILON ? circleStart : circleEnd,
  });
  return { entry: input.entry, exit: input.exit, segments };
}

function add(left: Point, right: Point): Point {
  return { x: left.x + right.x, y: left.y + right.y };
}

function subtract(left: Point, right: Point): Point {
  return { x: left.x - right.x, y: left.y - right.y };
}

function scale(point: Point, factor: number): Point {
  return { x: point.x * factor, y: point.y * factor };
}

function rotate(point: Point, angle: number): Point {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    x: point.x * cosine - point.y * sine,
    y: point.x * sine + point.y * cosine,
  };
}

function rotateQuarter(point: Point, direction: number): Point {
  return direction >= 0
    ? { x: -point.y, y: point.x }
    : { x: point.y, y: -point.x };
}

function normalize(point: Point): Point | null {
  const length = Math.hypot(point.x, point.y);
  return length <= EPSILON
    ? null
    : { x: point.x / length, y: point.y / length };
}

function dot(left: Point, right: Point): number {
  return left.x * right.x + left.y * right.y;
}

function cross(left: Point, right: Point): number {
  return left.x * right.y - left.y * right.x;
}

function distance(left: Point, right: Point): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}
