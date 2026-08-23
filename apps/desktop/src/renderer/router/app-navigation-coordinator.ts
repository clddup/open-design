import type {
  AppDestination,
  AppNavigationRequest,
  AppResolvedDestination,
} from "./app-route";

export type AppNavigationTransition = Readonly<{
  epoch: number;
  requested: AppNavigationRequest;
}>;

export interface AppRouteNavigationPort {
  back(): void;
  navigate(destination: AppDestination): void;
}

/**
 * Rejects stale asynchronous resource opens while the configured React
 * Router remains the only owner of destination and history.
 */
export class AppNavigationCoordinator {
  #epoch = 0;

  constructor(private readonly route: AppRouteNavigationPort) {}

  begin(requested: AppNavigationRequest): AppNavigationTransition {
    return Object.freeze({ epoch: ++this.#epoch, requested });
  }

  isCurrent(transition: AppNavigationTransition): boolean {
    return this.#epoch === transition.epoch;
  }

  commit(
    transition: AppNavigationTransition,
    destination: AppResolvedDestination,
  ): boolean {
    if (!this.isCurrent(transition)) return false;
    this.route.navigate(destination);
    return true;
  }

  fail(transition: AppNavigationTransition, reason: string): boolean {
    if (!this.isCurrent(transition)) return false;
    this.route.navigate({
      kind: "invalid",
      reason,
      requested: transition.requested,
    });
    return true;
  }

  cancel(transition: AppNavigationTransition): boolean {
    if (!this.isCurrent(transition)) return false;
    this.#epoch += 1;
    return true;
  }

  navigate(destination: AppResolvedDestination): void {
    this.#epoch += 1;
    this.route.navigate(destination);
  }

  openSettings(): void {
    this.navigate({ kind: "settings" });
  }

  closeSettings(): void {
    this.#epoch += 1;
    this.route.back();
  }
}
