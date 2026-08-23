import { useOutletContext } from "react-router-dom";
import { AgentTimeline } from "../../features/agent-conversation/components/AgentTimeline";
import type { AppRouteContext } from "../../router/route-context";
import { WorkspaceHome } from "../Workspace/WorkspaceHome";
import { ConversationHome } from "./ConversationHome";

export function ConversationPage() {
  const context = useOutletContext<AppRouteContext>();
  if (!context.conversation) {
    return (
      <WorkspaceHome {...context.workspace} error={context.invalidError} />
    );
  }
  return (
    <ConversationHome {...context.conversation.home}>
      <AgentTimeline {...context.conversation.timeline} />
    </ConversationHome>
  );
}
