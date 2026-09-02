import type { Point, ViewportState } from "@opendesign/design-contracts";
import { documentToScreen } from "@opendesign/editor-runtime";
import { formatDistanceMeasurement } from "@opendesign/geometry-service/measurements";
import type { RulerGuideDistanceMeasurement } from "../ruler-guide-measurements";
import { RULER_SIZE } from "../ruler-guides";
import styles from "./RulerGuides.module.scss";

export function RulerGuideMeasurements({
  measurements,
  viewport,
}: {
  measurements: readonly RulerGuideDistanceMeasurement[];
  viewport: ViewportState;
}) {
  return measurements.map((measurement) => {
    const start = documentToScreen(measurement.start, viewport);
    const end = documentToScreen(measurement.end, viewport);
    const text = formatDistanceMeasurement(measurement.value);
    const width = Math.max(26, text.length * 7 + 12);
    const center = clampedMeasurementCenter(start, end, width, viewport);
    return (
      <g data-ruler-measurement={measurement.id} key={measurement.id}>
        <line
          className={styles.measurementLine}
          x1={start.x}
          x2={end.x}
          y1={start.y}
          y2={end.y}
        />
        <rect
          className={styles.measurementLabelBackground}
          height={20}
          rx={3}
          width={width}
          x={center.x - width / 2}
          y={center.y - 10}
        />
        <text
          className={styles.measurementLabel}
          dominantBaseline="central"
          textAnchor="middle"
          x={center.x}
          y={center.y}
        >
          {text}
        </text>
      </g>
    );
  });
}

function clampedMeasurementCenter(
  start: Point,
  end: Point,
  labelWidth: number,
  viewport: ViewportState,
): Point {
  const padding = 3;
  const halfWidth = labelWidth / 2;
  return {
    x: clamp(
      (start.x + end.x) / 2,
      RULER_SIZE + halfWidth + padding,
      viewport.width - halfWidth - padding,
    ),
    y: clamp(
      (start.y + end.y) / 2,
      RULER_SIZE + 10 + padding,
      viewport.height - 10 - padding,
    ),
  };
}

function clamp(value: number, preferredMinimum: number, maximum: number) {
  const upper = Math.max(4, maximum);
  return Math.min(Math.max(value, Math.min(preferredMinimum, upper)), upper);
}
