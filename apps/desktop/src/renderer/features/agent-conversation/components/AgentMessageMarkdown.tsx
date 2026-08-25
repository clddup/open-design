import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./AgentMessageMarkdown.module.scss";

export function AgentMessageMarkdown({
  content,
  streaming = false,
}: {
  content: string;
  streaming?: boolean;
}) {
  return (
    <div
      className={styles.root}
      data-agent-message-markdown=""
      data-streaming={streaming ? "true" : "false"}
    >
      <Markdown
        components={{
          a: ({ children, href }) => (
            <span className={styles.link} title={href}>
              {children}
            </span>
          ),
        }}
        disallowedElements={["img"]}
        remarkPlugins={[remarkGfm]}
        skipHtml
        unwrapDisallowed
      >
        {content}
      </Markdown>
      {streaming && (
        <span aria-hidden="true" className={styles.caret} data-agent-caret="" />
      )}
    </div>
  );
}
