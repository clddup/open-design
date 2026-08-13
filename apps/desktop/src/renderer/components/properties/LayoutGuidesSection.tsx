import type { LayoutGuide } from "@opendesign/design-contracts";
import {
  DesktopSelect,
  DropdownMenu,
  DropdownMenuItem,
  Glyph,
  IconButton,
} from "@opendesign/ui";
import { useI18n } from "../../i18n";
import styles from "../PropertiesPanel.module.scss";
import { Field, formatNumber } from "./controls";

export function LayoutGuidesSection({
  frameId,
  guides,
  onChange,
}: {
  frameId: string;
  guides: readonly LayoutGuide[];
  onChange: (guides: readonly LayoutGuide[]) => void;
}) {
  const { t } = useI18n();
  const add = (type: LayoutGuide["type"]) => {
    onChange([...guides, defaultGuide(nextGuideId(frameId, guides), type)]);
  };
  const replace = (guideId: string, guide: LayoutGuide) =>
    onChange(guides.map((item) => (item.id === guideId ? guide : item)));
  return (
    <div className={styles.stack}>
      <div className={styles.layoutGuideToolbar}>
        <span>{t("properties.layoutGuides")}</span>
        <DropdownMenu
          icon={<Glyph name="plus" />}
          label={t("properties.layoutGuideAdd")}
          disabled={guides.length >= 8}
        >
          <DropdownMenuItem onSelect={() => add("grid")}>
            {t("properties.layoutGuideGrid")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => add("columns")}>
            {t("properties.layoutGuideColumns")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => add("rows")}>
            {t("properties.layoutGuideRows")}
          </DropdownMenuItem>
        </DropdownMenu>
      </div>
      {guides.map((guide) => (
        <GuideEditor
          guide={guide}
          key={guide.id}
          onChange={(next) => replace(guide.id, next)}
          onRemove={() =>
            onChange(guides.filter((item) => item.id !== guide.id))
          }
        />
      ))}
    </div>
  );
}

function GuideEditor({
  guide,
  onChange,
  onRemove,
}: {
  guide: LayoutGuide;
  onChange: (guide: LayoutGuide) => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className={styles.layoutGuide}>
      <DesktopSelect
        ariaLabel={`${t("properties.layoutGuideType")} ${guide.id}`}
        onValueChange={(type) =>
          onChange(defaultGuide(guide.id, type as LayoutGuide["type"], guide))
        }
        options={[
          { value: "grid", label: t("properties.layoutGuideGrid") },
          { value: "columns", label: t("properties.layoutGuideColumns") },
          { value: "rows", label: t("properties.layoutGuideRows") },
        ]}
        size="compact"
        value={guide.type}
      />
      <IconButton
        icon="trash"
        label={`${t("properties.layoutGuideRemove")} ${guide.id}`}
        onClick={onRemove}
      />
      {guide.type === "grid" ? (
        <NumberGuideField
          guide={guide}
          label={t("properties.layoutGuideSize")}
          max={10_000}
          min={1}
          onChange={(size) => onChange({ ...guide, size })}
          value={guide.size}
        />
      ) : (
        <AxisGuideFields guide={guide} onChange={onChange} />
      )}
      <Field
        accessibleLabel={`${t("properties.layoutGuideColor")} ${guide.id}`}
        label={t("properties.layoutGuideColor")}
        onCommit={(color) => {
          const next = color.trim();
          if (!next) return null;
          if (next !== guide.color) onChange({ ...guide, color: next });
          return next;
        }}
        type="text"
        value={guide.color}
      />
      <NumberGuideField
        guide={guide}
        label={t("properties.layoutGuideOpacity")}
        max={1}
        min={0}
        onChange={(opacity) => onChange({ ...guide, opacity })}
        value={guide.opacity}
        suffix=""
      />
    </div>
  );
}

function AxisGuideFields({
  guide,
  onChange,
}: {
  guide: Exclude<LayoutGuide, { type: "grid" }>;
  onChange: (guide: LayoutGuide) => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <label className={styles.select}>
        <span>{t("properties.layoutGuideAlignment")}</span>
        <DesktopSelect
          ariaLabel={`${t("properties.layoutGuideAlignment")} ${guide.id}`}
          onValueChange={(alignment) =>
            onChange(convertAlignment(guide, alignment as AxisAlignment))
          }
          options={axisAlignmentOptions(guide.type, t)}
          size="compact"
          value={guide.alignment}
        />
      </label>
      <NumberGuideField
        guide={guide}
        integer
        label={t("properties.layoutGuideCount")}
        max={4_096}
        min={1}
        onChange={(count) => onChange({ ...guide, count })}
        value={guide.count}
        suffix=""
      />
      {guide.alignment === "stretch" ? (
        <NumberGuideField
          guide={guide}
          label={t("properties.layoutGuideMargin")}
          min={0}
          onChange={(margin) => onChange({ ...guide, margin })}
          value={guide.margin}
        />
      ) : (
        <NumberGuideField
          guide={guide}
          label={t("properties.layoutGuideSectionSize")}
          min={0.001}
          onChange={(sectionSize) => onChange({ ...guide, sectionSize })}
          value={guide.sectionSize}
        />
      )}
      <NumberGuideField
        guide={guide}
        label={t("properties.layoutGuideGutter")}
        min={0}
        onChange={(gutter) => onChange({ ...guide, gutter })}
        value={guide.gutter}
      />
      {(guide.alignment === "start" || guide.alignment === "end") && (
        <NumberGuideField
          guide={guide}
          label={t("properties.layoutGuideOffset")}
          min={0}
          onChange={(offset) => onChange({ ...guide, offset })}
          value={guide.offset}
        />
      )}
    </>
  );
}

function NumberGuideField({
  guide,
  integer = false,
  label,
  max = 1_000_000,
  min,
  onChange,
  suffix = "px",
  value,
}: {
  guide: LayoutGuide;
  integer?: boolean;
  label: string;
  max?: number;
  min: number;
  onChange: (value: number) => void;
  suffix?: string;
  value: number;
}) {
  return (
    <Field
      accessibleLabel={`${label} ${guide.id}`}
      label={label}
      max={max}
      min={min}
      onCommit={(draft) => {
        const next = Number(draft);
        if (
          !Number.isFinite(next) ||
          next < min ||
          next > max ||
          (integer && !Number.isInteger(next))
        ) {
          return null;
        }
        if (next !== value) onChange(next);
        return formatNumber(next);
      }}
      suffix={suffix || undefined}
      value={formatNumber(value)}
    />
  );
}

type AxisAlignment = "start" | "center" | "end" | "stretch";

function convertAlignment(
  guide: Exclude<LayoutGuide, { type: "grid" }>,
  alignment: AxisAlignment,
): Exclude<LayoutGuide, { type: "grid" }> {
  const common = {
    id: guide.id,
    type: guide.type,
    count: guide.count,
    gutter: guide.gutter,
    color: guide.color,
    opacity: guide.opacity,
  };
  if (alignment === "stretch") {
    return { ...common, alignment, margin: 0 };
  }
  if (alignment === "center") {
    return { ...common, alignment, sectionSize: 80 };
  }
  return { ...common, alignment, sectionSize: 80, offset: 0 };
}

function defaultGuide(
  id: string,
  type: LayoutGuide["type"],
  appearance?: Pick<LayoutGuide, "color" | "opacity">,
): LayoutGuide {
  const common = {
    id,
    color: appearance?.color ?? "#ff5a5f",
    opacity: appearance?.opacity ?? 0.12,
  };
  if (type === "grid") return { ...common, type, size: 8 };
  return {
    ...common,
    type,
    alignment: "stretch",
    count: type === "columns" ? 12 : 8,
    gutter: type === "columns" ? 24 : 16,
    margin: type === "columns" ? 64 : 32,
  };
}

function nextGuideId(frameId: string, guides: readonly LayoutGuide[]): string {
  const existing = new Set(guides.map((guide) => guide.id));
  let sequence = 1;
  while (existing.has(`${frameId}_guide_${sequence}`)) sequence += 1;
  return `${frameId}_guide_${sequence}`;
}

function axisAlignmentOptions(
  type: "columns" | "rows",
  t: ReturnType<typeof useI18n>["t"],
) {
  return [
    {
      value: "start",
      label: t(
        type === "columns"
          ? "properties.layoutGuideLeft"
          : "properties.layoutGuideTop",
      ),
    },
    { value: "center", label: t("properties.layoutGuideCenter") },
    {
      value: "end",
      label: t(
        type === "columns"
          ? "properties.layoutGuideRight"
          : "properties.layoutGuideBottom",
      ),
    },
    { value: "stretch", label: t("properties.layoutGuideStretch") },
  ];
}
