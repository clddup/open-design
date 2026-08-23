import { matchPath, type To } from "react-router-dom";

export type AppResolvedDestination =
  | { kind: "workspace" }
  | { kind: "project"; projectId: string }
  | { kind: "conversation"; conversationId: string }
  | { kind: "editor"; fileKey: string }
  | { kind: "settings" };

export type AppNavigationRequest =
  | AppResolvedDestination
  | { kind: "project"; projectId?: string }
  | { kind: "editor"; fileKey?: string };

export type AppInvalidDestination = {
  kind: "invalid";
  reason: string;
  requested: AppNavigationRequest;
};

export type AppDestination = AppResolvedDestination | AppInvalidDestination;

export type AppRouteTarget = {
  state?: unknown;
  to: To;
};

type InvalidRouteState = {
  kind: "invalid";
  reason: string;
  requested: AppNavigationRequest;
};

/** Maps trusted application destinations to package-safe Router paths. */
export function appRoute(destination: AppDestination): AppRouteTarget {
  switch (destination.kind) {
    case "workspace":
      return { to: "/" };
    case "project":
      return {
        to: `/projects/${encodeURIComponent(destination.projectId)}`,
      };
    case "conversation":
      return {
        to: `/conversations/${encodeURIComponent(destination.conversationId)}`,
      };
    case "editor":
      return { to: `/editor/${encodeURIComponent(destination.fileKey)}` };
    case "settings":
      return { to: "/settings" };
    case "invalid":
      return {
        to: "/invalid",
        state: {
          kind: "invalid",
          reason: destination.reason,
          requested: destination.requested,
        } satisfies InvalidRouteState,
      };
  }
}

export function appDestination(
  pathname: string,
  state: unknown,
): AppDestination {
  if (pathname === "/") return { kind: "workspace" };
  if (pathname === "/settings") return { kind: "settings" };
  if (pathname === "/invalid") {
    return isInvalidRouteState(state)
      ? {
          kind: "invalid",
          reason: state.reason,
          requested: state.requested,
        }
      : {
          kind: "invalid",
          reason: "The requested application destination is unavailable",
          requested: { kind: "workspace" },
        };
  }
  const project = routeParameter("/projects/:projectId", pathname, "projectId");
  if (project) return { kind: "project", projectId: project };
  const conversation = routeParameter(
    "/conversations/:conversationId",
    pathname,
    "conversationId",
  );
  if (conversation) {
    return { kind: "conversation", conversationId: conversation };
  }
  const fileKey = routeParameter("/editor/:fileKey", pathname, "fileKey");
  if (fileKey) return { kind: "editor", fileKey };
  return {
    kind: "invalid",
    reason: "The requested application destination is unavailable",
    requested: { kind: "workspace" },
  };
}

function routeParameter(
  pattern: string,
  pathname: string,
  parameter: string,
): string | null {
  const value = matchPath(pattern, pathname)?.params[parameter];
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function isInvalidRouteState(value: unknown): value is InvalidRouteState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<InvalidRouteState>;
  return (
    candidate.kind === "invalid" &&
    typeof candidate.reason === "string" &&
    isNavigationRequest(candidate.requested)
  );
}

function isNavigationRequest(value: unknown): value is AppNavigationRequest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AppNavigationRequest>;
  if (candidate.kind === "workspace" || candidate.kind === "settings") {
    return true;
  }
  if (candidate.kind === "project") {
    return (
      candidate.projectId === undefined ||
      typeof candidate.projectId === "string"
    );
  }
  if (candidate.kind === "conversation") {
    return typeof candidate.conversationId === "string";
  }
  return (
    candidate.kind === "editor" &&
    (candidate.fileKey === undefined || typeof candidate.fileKey === "string")
  );
}
