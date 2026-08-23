import { useOutletContext } from "react-router-dom";
import { EditorWorkbenchFeature } from "../../features/editor-workbench/EditorWorkbenchFeature";
import type { AppRouteContext } from "../../router/route-context";

export function EditorPage() {
  const { editor } = useOutletContext<AppRouteContext>();
  return <EditorWorkbenchFeature {...editor} />;
}
