import type { Guide, ViewportState } from "@opendesign/design-contracts";
import { useMemo, type PointerEvent as ReactPointerEvent } from "react";
import { rulerTicks, RULER_SIZE } from "../ruler-guides";
import styles from "./RulerGuides.module.scss";

export function RulerScale({
  onPointerDown,
  ranges,
  viewport,
}: {
  onPointerDown: (
    axis: Guide["axis"],
    event: ReactPointerEvent<SVGElement>,
  ) => void;
  ranges: { x: readonly [number, number]; y: readonly [number, number] } | null;
  viewport: ViewportState;
}) {
  const xTicks = useMemo(() => rulerTicks("X", viewport), [viewport]);
  const yTicks = useMemo(() => rulerTicks("Y", viewport), [viewport]);
  return (
    <svg aria-hidden="true" className={styles.rulers}>
      <rect
        className={styles.horizontalRuler}
        data-ruler-axis="Y"
        height={RULER_SIZE}
        onPointerDown={(event) => onPointerDown("Y", event)}
        width="100%"
        x={RULER_SIZE}
        y={0}
      />
      <rect
        className={styles.verticalRuler}
        data-ruler-axis="X"
        height="100%"
        onPointerDown={(event) => onPointerDown("X", event)}
        width={RULER_SIZE}
        x={0}
        y={RULER_SIZE}
      />
      <rect className={styles.corner} height={RULER_SIZE} width={RULER_SIZE} />
      {ranges && (
        <>
          <rect
            className={styles.selectionRange}
            height={RULER_SIZE}
            width={Math.max(0, ranges.x[1] - ranges.x[0])}
            x={ranges.x[0]}
            y={0}
          />
          <rect
            className={styles.selectionRange}
            height={Math.max(0, ranges.y[1] - ranges.y[0])}
            width={RULER_SIZE}
            x={0}
            y={ranges.y[0]}
          />
        </>
      )}
      {xTicks.map((tick) => (
        <g key={`x:${tick.value}`}>
          <line
            className={styles.tick}
            x1={tick.position}
            x2={tick.position}
            y1={tick.major ? 8 : 14}
            y2={RULER_SIZE}
          />
          {tick.major && (
            <text className={styles.tickLabel} x={tick.position + 3} y={8}>
              {formatOffset(tick.value)}
            </text>
          )}
        </g>
      ))}
      {yTicks.map((tick) => (
        <g key={`y:${tick.value}`}>
          <line
            className={styles.tick}
            x1={tick.major ? 8 : 14}
            x2={RULER_SIZE}
            y1={tick.position}
            y2={tick.position}
          />
          {tick.major && (
            <text
              className={styles.verticalTickLabel}
              transform={`translate(8 ${tick.position - 3}) rotate(-90)`}
            >
              {formatOffset(tick.value)}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

function formatOffset(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
