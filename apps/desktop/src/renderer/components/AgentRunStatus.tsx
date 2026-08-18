import { useEffect, useState } from "react";
import type { Translate } from "../features/agent-conversation/timeline-types";
import {
  agentRunPhaseDetailKey,
  agentRunPhaseTitleKey,
  type AgentRunExperience,
} from "../features/agent-conversation/agent-run-experience";
import styles from "./AgentRunStatus.module.scss";

export function AgentRunStatus({
  experience,
  t,
}: {
  experience: AgentRunExperience;
  t: Translate;
}) {
  const elapsed = useElapsed(
    experience.active ? experience.startedAt : undefined,
  );
  return (
    <section
      aria-label={t("agent.runStatus")}
      aria-live="polite"
      className={styles.root}
      data-phase={experience.phase}
      role="status"
    >
      <span aria-hidden="true" className={styles.indicator} />
      <span className={styles.copy}>
        <strong>{t(agentRunPhaseTitleKey(experience.phase))}</strong>
        <small>{t(agentRunPhaseDetailKey(experience.phase))}</small>
      </span>
      <span className={styles.facts}>
        {elapsed && <span>{elapsed}</span>}
        {experience.totalTargetCount > 0 && (
          <span>
            {t("agent.realArtboardsCount", {
              completed: experience.allocatedTargetCount,
              total: experience.totalTargetCount,
            })}
          </span>
        )}
        {experience.verifiedTargetCount > 0 && (
          <span>
            {t("agent.finishedTargetsCount", {
              completed: experience.verifiedTargetCount,
              total: experience.totalTargetCount,
            })}
          </span>
        )}
        {experience.recoverableFailureCount > 0 && (
          <span>
            {t("agent.automaticCorrections", {
              count: experience.recoverableFailureCount,
            })}
          </span>
        )}
        {experience.partialWorkPreserved && (
          <span>{t("agent.partialWorkPreserved")}</span>
        )}
      </span>
    </section>
  );
}

function useElapsed(startedAt: string | undefined): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  if (!startedAt) return null;
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started)) return null;
  const seconds = Math.max(0, Math.floor((now - started) / 1_000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}
