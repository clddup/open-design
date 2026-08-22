import type { ConversationOpenIssue } from "../agent-conversation/use-conversation-lifecycle-state";

export type AppResolvedDestination =
  | { kind: "workspace" }
  | { kind: "project"; projectId: string }
  | {
      kind: "conversation";
      conversationId: string;
      issue: ConversationOpenIssue;
    }
  | { kind: "editor"; fileKey: string };

export type AppNavigationRequest =
  | AppResolvedDestination
  | { kind: "project"; projectId?: string }
  | { kind: "editor"; fileKey?: string };

export type AppInvalidDestination = {
  kind: "invalid";
  reason: string;
  requested: AppNavigationRequest;
};

export type AppDestination =
  | AppResolvedDestination
  | AppInvalidDestination
  | {
      kind: "settings";
      returnTo: AppResolvedDestination | AppInvalidDestination;
    };

export type AppNavigationTransition = Readonly<{
  epoch: number;
  requested: AppNavigationRequest;
}>;

export type AppNavigationSnapshot = Readonly<{
  destination: AppDestination;
  pending: AppNavigationTransition | null;
}>;

type Listener = () => void;

/**
 * Owns application destination transitions. Resource controllers may prepare
 * data asynchronously, but only the latest transition can publish a route.
 */
export class AppNavigator {
  #epoch = 0;
  readonly #listeners = new Set<Listener>();
  #snapshot: AppNavigationSnapshot;

  constructor(initialDestination: AppResolvedDestination) {
    this.#snapshot = {
      destination: initialDestination,
      pending: null,
    };
  }

  getSnapshot = (): AppNavigationSnapshot => this.#snapshot;

  subscribe = (listener: Listener): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  begin(requested: AppNavigationRequest): AppNavigationTransition {
    const transition = Object.freeze({
      epoch: ++this.#epoch,
      requested,
    });
    this.#publish({
      destination: this.#snapshot.destination,
      pending: transition,
    });
    return transition;
  }

  isCurrent(transition: AppNavigationTransition): boolean {
    return this.#epoch === transition.epoch;
  }

  commit(
    transition: AppNavigationTransition,
    destination: AppResolvedDestination,
  ): boolean {
    if (
      !this.isCurrent(transition) ||
      this.#snapshot.pending?.epoch !== transition.epoch
    ) {
      return false;
    }
    this.#publish({ destination, pending: null });
    return true;
  }

  fail(transition: AppNavigationTransition, reason: string): boolean {
    if (
      !this.isCurrent(transition) ||
      this.#snapshot.pending?.epoch !== transition.epoch
    ) {
      return false;
    }
    this.#publish({
      destination: {
        kind: "invalid",
        reason,
        requested: transition.requested,
      },
      pending: null,
    });
    return true;
  }

  cancel(transition: AppNavigationTransition): boolean {
    if (
      !this.isCurrent(transition) ||
      this.#snapshot.pending?.epoch !== transition.epoch
    ) {
      return false;
    }
    this.#publish({
      destination: this.#snapshot.destination,
      pending: null,
    });
    return true;
  }

  navigate(destination: AppResolvedDestination): void {
    this.#epoch += 1;
    this.#publish({ destination, pending: null });
  }

  openSettings(): void {
    const current = this.#snapshot.destination;
    if (current.kind === "settings") return;
    this.#epoch += 1;
    this.#publish({
      destination: { kind: "settings", returnTo: current },
      pending: null,
    });
  }

  closeSettings(): void {
    const current = this.#snapshot.destination;
    if (current.kind !== "settings") return;
    this.#epoch += 1;
    this.#publish({ destination: current.returnTo, pending: null });
  }

  #publish(snapshot: AppNavigationSnapshot): void {
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) listener();
  }
}
