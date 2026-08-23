import { Outlet } from "react-router-dom";
import { useAppRouteContext } from "./use-app-route-context";

export function AppLayout() {
  const { conversationDeleteDialog, destination, notifications, routeContext } =
    useAppRouteContext();

  return (
    <>
      <Outlet context={routeContext} />
      {destination.kind !== "editor" && conversationDeleteDialog}
      {destination.kind !== "editor" && notifications}
    </>
  );
}
