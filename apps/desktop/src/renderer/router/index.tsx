import { createHashRouter, createMemoryRouter } from "react-router-dom";
import { appRoute, type AppResolvedDestination } from "./app-route";
import { appRoutes } from "./routes";

/** Production uses package-safe hash history; tests inject one memory entry. */
export function createAppRouter(
  initialDestination?: AppResolvedDestination,
): ReturnType<typeof createHashRouter> {
  if (initialDestination) {
    return createMemoryRouter(appRoutes, {
      initialEntries: [appRoute(initialDestination).to],
    });
  }
  return createHashRouter(appRoutes);
}
