import type { AgentAssistantBlock, Translate } from "../timeline-types";
import { AgentMessageMarkdown } from "./AgentMessageMarkdown";
import styles from "./AssistantMessageBlocks.module.scss";

export function AssistantMessageBlocks({
  blocks,
  state,
  t,
}: {
  blocks: readonly AgentAssistantBlock[];
  state: "active" | "done" | "stopping" | "queued" | "error";
  t: Translate;
}) {
  return blocks.map((block) =>
    block.type === "text" ? (
      <AgentMessageMarkdown
        content={block.content}
        key={block.blockId}
        streaming={state === "active" && block.state === "active"}
      />
    ) : (
      <details
        className={styles.reasoning}
        data-agent-reasoning=""
        key={block.blockId}
      >
        <summary>
          <span aria-hidden="true" className={styles.chevron}>
            ›
          </span>
          <span>{t("agent.modelThinkingSummary")}</span>
        </summary>
        <AgentMessageMarkdown content={block.content} streaming={false} />
        <small>{t("agent.reasoningSummaryNotice")}</small>
      </details>
    ),
  );
}
