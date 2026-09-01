import type { ArrangeOperation } from "@opendesign/editor-runtime";
import { Icon, type IconName } from "@opendesign/ui";
import type { MessageKey } from "@/shared/i18n/messages";
import { useI18n } from "../../../../i18n";
import styles from "../PropertiesPanel.module.scss";

const ACTIONS: readonly [
  Extract<ArrangeOperation["action"], `align-${string}`>,
  IconName,
  MessageKey,
][] = [
  ["align-left", "lucide:align-start-horizontal", "properties.alignLeft"],
  [
    "align-horizontal-center",
    "lucide:align-center-horizontal",
    "properties.alignHCenter",
  ],
  ["align-right", "lucide:align-end-horizontal", "properties.alignRight"],
  ["align-top", "lucide:align-start-vertical", "properties.alignTop"],
  [
    "align-vertical-center",
    "lucide:align-center-vertical",
    "properties.alignVCenter",
  ],
  ["align-bottom", "lucide:align-end-vertical", "properties.alignBottom"],
];

export function AlignmentControls({
  disabled,
  onArrange,
}: {
  disabled: boolean;
  onArrange: (operation: ArrangeOperation) => void;
}) {
  const { t } = useI18n();
  return (
    <div
      aria-label={t("properties.alignment")}
      className={styles.alignmentGrid}
      role="group"
    >
      {ACTIONS.map(([action, icon, label]) => (
        <button
          aria-label={t(label)}
          disabled={disabled}
          key={action}
          onClick={() => onArrange({ action })}
          type="button"
        >
          <Icon name={icon} size={15} />
        </button>
      ))}
    </div>
  );
}
