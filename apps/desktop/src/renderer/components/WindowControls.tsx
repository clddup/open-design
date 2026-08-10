import { IconButton } from "@opendesign/ui";
import { useI18n } from "../i18n";

export function WindowControls() {
  const { t } = useI18n();
  const runWindowAction = (
    action: "minimize" | "toggle-maximize" | "close",
  ) => {
    void window.desktop?.windowAction(action);
  };

  return (
    <div
      aria-label={t("window.controls")}
      className="window-controls"
      role="group"
    >
      <IconButton
        icon="minimize"
        label={t("window.minimize")}
        onClick={() => runWindowAction("minimize")}
      />
      <IconButton
        icon="maximize"
        label={t("window.maximize")}
        onClick={() => runWindowAction("toggle-maximize")}
      />
      <IconButton
        className="window-control--close"
        icon="close"
        label={t("window.close")}
        onClick={() => runWindowAction("close")}
      />
    </div>
  );
}
