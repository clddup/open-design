import {
  vectorNetworkHasBranches,
  type VariableWidthStrokeProperties,
  type VectorNetworkProperties,
} from "@opendesign/design-contracts";
import { useI18n } from "../../../../i18n";
import type { UpdatePropertiesPatch } from "@/renderer/features/editor";
import styles from "../PropertiesPanel.module.scss";

const PRESET_PROFILES = [
  "UNIFORM",
  "WEDGE",
  "TAPER",
  "QUARTER_TAPER",
  "EYE",
  "MIRRORED_TAPER",
] as const satisfies readonly Exclude<
  VariableWidthStrokeProperties["widthProfile"],
  "CUSTOM"
>[];

const profileMessageKeys = {
  CUSTOM: "properties.variableWidthCustom",
  EYE: "properties.variableWidthEye",
  MIRRORED_TAPER: "properties.variableWidthMirroredTaper",
  QUARTER_TAPER: "properties.variableWidthQuarterTaper",
  TAPER: "properties.variableWidthTaper",
  UNIFORM: "properties.variableWidthUniform",
  WEDGE: "properties.variableWidthWedge",
} as const;

export function VariableWidthStrokeSection({
  onUpdate,
  properties,
}: {
  onUpdate: (updates: UpdatePropertiesPatch) => void;
  properties: VectorNetworkProperties;
}) {
  const { t } = useI18n();
  const profile =
    properties.variableWidthStrokeProperties?.widthProfile ?? "UNIFORM";
  const unavailableReasonKey = variableWidthUnavailableReason(properties);
  const unavailableReason = unavailableReasonKey
    ? t(unavailableReasonKey)
    : null;

  return (
    <>
      <label className={styles.select} title={unavailableReason ?? undefined}>
        <span>{t("properties.variableWidth")}</span>
        <select
          aria-label={t("properties.variableWidth")}
          disabled={unavailableReason !== null}
          onChange={(event) =>
            onUpdate({
              properties: {
                variableWidthStrokeProperties: {
                  widthProfile: event.target
                    .value as (typeof PRESET_PROFILES)[number],
                },
              },
            })
          }
          value={profile}
        >
          {PRESET_PROFILES.map((candidate) => (
            <option key={candidate} value={candidate}>
              {t(profileMessageKeys[candidate])}
            </option>
          ))}
          {profile === "CUSTOM" && (
            <option disabled value="CUSTOM">
              {t(profileMessageKeys.CUSTOM)}
            </option>
          )}
        </select>
      </label>
      {unavailableReason && (
        <small className={styles.hint}>{unavailableReason}</small>
      )}
    </>
  );
}

function variableWidthUnavailableReason(
  properties: VectorNetworkProperties,
):
  | "properties.variableWidthDashedUnavailable"
  | "properties.variableWidthBranchUnavailable"
  | null {
  if ((properties.dashPattern?.length ?? 0) > 0) {
    return "properties.variableWidthDashedUnavailable";
  }
  if (vectorNetworkHasBranches(properties.network)) {
    return "properties.variableWidthBranchUnavailable";
  }
  return null;
}
