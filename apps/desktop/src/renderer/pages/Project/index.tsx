import { useOutletContext } from "react-router-dom";
import { WorkspaceHome } from "../Workspace/WorkspaceHome";
import { ProjectHome } from "./ProjectHome";
import type { AppRouteContext } from "../../router/route-context";

export function ProjectPage() {
  const context = useOutletContext<AppRouteContext>();
  return context.project ? (
    <ProjectHome {...context.project} />
  ) : (
    <WorkspaceHome {...context.workspace} error={context.invalidError} />
  );
}
