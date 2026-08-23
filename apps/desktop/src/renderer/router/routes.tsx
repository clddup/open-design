import type { RouteObject } from "react-router-dom";
import { AppLayout } from "../layouts/AppLayout";
import { ConversationPage } from "../pages/Conversation";
import { EditorPage } from "../pages/Editor";
import { InvalidPage } from "../pages/Invalid";
import { NotFoundPage } from "../pages/NotFound";
import { ProjectPage } from "../pages/Project";
import { SettingsPage } from "../pages/Settings";
import { WorkspacePage } from "../pages/Workspace";

export const appRoutes: RouteObject[] = [
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: <WorkspacePage /> },
      { path: "projects/:projectId", element: <ProjectPage /> },
      {
        path: "conversations/:conversationId",
        element: <ConversationPage />,
      },
      { path: "editor/:fileKey", element: <EditorPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "invalid", element: <InvalidPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];
