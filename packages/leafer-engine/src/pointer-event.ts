import type { Point } from "@opendesign/design-contracts";

export interface LeaferEventLike {
  altKey: boolean;
  clientX: number;
  clientY: number;
  ctrlKey?: boolean;
  getInnerPoint(relative: unknown): { x: number; y: number };
  isCancel?: boolean;
  middle?: boolean;
  metaKey?: boolean;
  right?: boolean;
  shiftKey: boolean;
  target: unknown;
  timeStamp?: number;
  x?: number;
  y?: number;
}

export function asLeaferEvent(value: unknown): LeaferEventLike {
  return value as LeaferEventLike;
}

export function eventClientPoint(event: LeaferEventLike): Point {
  return {
    x: Number.isFinite(event.clientX) ? event.clientX : (event.x ?? 0),
    y: Number.isFinite(event.clientY) ? event.clientY : (event.y ?? 0),
  };
}
