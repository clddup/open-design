import { MessageProvider } from "@opendesign/ui";
import { useState } from "react";
import { RouterProvider } from "react-router-dom";
import { useEditorRuntime } from "./state/editor-runtime";
import { useI18n } from "./i18n";
import { createAppRouter } from "./router";
import type { AppResolvedDestination } from "./router/app-route";

type AppInitialView = "workspace" | "editor";

export function App({ initialView }: { initialView?: AppInitialView } = {}) {
  const { t } = useI18n();
  const { workspaceSnapshot } = useEditorRuntime();
  const [router] = useState(() =>
    createAppRouter(
      initialDestination(initialView, workspaceSnapshot.activeFileKey),
    ),
  );
  return (
    <MessageProvider
      dismissLabel={t("message.dismiss")}
      regionLabel={t("message.region")}
    >
      <RouterProvider router={router} />
    </MessageProvider>
  );
}

function initialDestination(
  initialView: AppInitialView | undefined,
  activeFileKey: string,
): AppResolvedDestination | undefined {
  if (!initialView) return undefined;
  return initialView === "editor"
    ? { kind: "editor", fileKey: activeFileKey }
    : { kind: "workspace" };
}
