import { reportRendererError } from "../../features/diagnostics/diagnostics";
import { useEffect, useState } from "react";
import { IconButton } from "@opendesign/ui";
import { useI18n } from "../../i18n";
import styles from "./WindowControls.module.scss";

export function WindowControls() {
  const { t } = useI18n();
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    let active = true;
    let receivedEvent = false;
    const unsubscribe = window.desktop?.onWindowMaximized((value) => {
      receivedEvent = true;
      setMaximized(value);
    });
    void window.desktop
      ?.getWindowMaximized()
      .then((value) => {
        if (active && !receivedEvent) setMaximized(value);
      })
      .catch((error: unknown) => {
        reportRendererError(
          "window_state_read_failed",
          error,
          "Unable to read window state",
        );
      });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);
  const runWindowAction = (
    action: "minimize" | "toggle-maximize" | "close",
  ) => {
    void window.desktop?.windowAction(action);
  };

  return (
    <div aria-label={t("window.controls")} className={styles.root} role="group">
      <IconButton
        icon="lucide:minus"
        label={t("window.minimize")}
        onClick={() => runWindowAction("minimize")}
      />
      <IconButton
        icon={maximized ? "lucide:copy" : "lucide:maximize-2"}
        label={t(maximized ? "window.restore" : "window.maximize")}
        onClick={() => runWindowAction("toggle-maximize")}
      />
      <IconButton
        className={styles.close}
        icon="lucide:x"
        label={t("window.close")}
        onClick={() => runWindowAction("close")}
      />
    </div>
  );
}
