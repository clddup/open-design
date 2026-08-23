import type { ReactNode } from "react";
import type { AgentTimelineProps } from "../features/agent-conversation/components/AgentTimeline";
import type { EditorWorkbenchFeatureProps } from "../features/editor-workbench/EditorWorkbenchFeature";
import type { ConversationHomeProps } from "../pages/Conversation/ConversationHome";
import type { ProjectHomeProps } from "../pages/Project/ProjectHome";
import type { SettingsPageProps } from "../pages/Settings/SettingsView";
import type { WorkspaceHomeProps } from "../pages/Workspace/WorkspaceHome";
import type { AppDestination } from "./app-route";

export type AppRouteContext = {
  conversation: {
    home: Omit<ConversationHomeProps, "children">;
    timeline: AgentTimelineProps;
  } | null;
  destination: AppDestination;
  editor: EditorWorkbenchFeatureProps;
  invalidError: string | null;
  overlays: {
    conversationDeleteDialog: ReactNode;
    notifications: ReactNode;
  };
  project: ProjectHomeProps | null;
  settings: SettingsPageProps;
  workspace: WorkspaceHomeProps;
};
