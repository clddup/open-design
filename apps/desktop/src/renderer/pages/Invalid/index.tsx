import { useOutletContext } from "react-router-dom";
import type { AppRouteContext } from "../../router/route-context";
import { WorkspaceHome } from "../Workspace/WorkspaceHome";

export function InvalidPage() {
  const context = useOutletContext<AppRouteContext>();
  return <WorkspaceHome {...context.workspace} error={context.invalidError} />;
}
