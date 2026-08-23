import { useOutletContext } from "react-router-dom";
import { WorkspaceHome } from "./WorkspaceHome";
import type { AppRouteContext } from "../../router/route-context";

export function WorkspacePage() {
  const { workspace } = useOutletContext<AppRouteContext>();
  return <WorkspaceHome {...workspace} />;
}
