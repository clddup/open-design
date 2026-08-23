import { Icon, type IconName } from "@opendesign/ui";
import type { ReactNode } from "react";
import styles from "./HomeTitlebar.module.scss";
import { WindowControls } from "./WindowControls";

export function HomeTitlebar({
  actions,
  icon,
  identity,
  platform,
  surface = "translucent",
}: {
  actions: ReactNode;
  icon: IconName;
  identity: ReactNode;
  platform: NodeJS.Platform;
  surface?: "solid" | "translucent";
}) {
  return (
    <header
      className={`${styles.root}${surface === "solid" ? ` ${styles.solid}` : ""}`}
      data-platform={platform}
    >
      <div aria-hidden="true" className={styles.nativeSafeZone} />
      <div className={styles.identity}>
        <span className={styles.brandMark}>
          <Icon name={icon} size={15} />
        </span>
        {identity}
      </div>
      <div className={`${styles.actions} no-drag`}>
        {actions}
        {platform !== "darwin" && <WindowControls />}
      </div>
    </header>
  );
}
