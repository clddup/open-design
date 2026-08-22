export type DesktopApplicationDisposer = () => Promise<void> | void;

export type DesktopApplicationState = "idle" | "starting" | "ready" | "failed";

export interface DesktopApplicationOptions {
  exit(code: number): void;
  reportStartupError(error: unknown): void;
}

type RegisteredDisposer = {
  label: string;
  dispose: DesktopApplicationDisposer;
};

export class DesktopApplicationStartContext {
  readonly #disposers: RegisteredDisposer[] = [];
  #committed = false;

  defer(label: string, dispose: DesktopApplicationDisposer): void {
    if (this.#committed) {
      throw new Error("Cannot register a startup disposer after commit");
    }
    if (label.trim().length === 0) {
      throw new TypeError("Startup disposer label is required");
    }
    this.#disposers.push({ label, dispose });
  }

  commit(): void {
    if (this.#committed)
      throw new Error("Desktop startup is already committed");
    this.#committed = true;
  }

  get committed(): boolean {
    return this.#committed;
  }

  async rollback(): Promise<void> {
    if (this.#committed) return;
    const failures: Error[] = [];
    for (const { label, dispose } of this.#disposers.reverse()) {
      try {
        await dispose();
      } catch (error) {
        failures.push(
          new Error(
            `${label}: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          ),
        );
      }
    }
    this.#disposers.length = 0;
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        "Desktop startup rollback was incomplete",
      );
    }
  }
}

/** Owns one atomic Main startup attempt and its reverse-order rollback. */
export class DesktopApplication {
  readonly #options: DesktopApplicationOptions;
  #startPromise: Promise<void> | null = null;
  #state: DesktopApplicationState = "idle";

  constructor(options: DesktopApplicationOptions) {
    this.#options = options;
  }

  get state(): DesktopApplicationState {
    return this.#state;
  }

  start(
    initialize: (context: DesktopApplicationStartContext) => Promise<void>,
  ): Promise<void> {
    if (this.#state === "ready") return Promise.resolve();
    if (this.#state === "failed") {
      return Promise.reject(
        new Error("Desktop application startup has failed"),
      );
    }
    if (this.#startPromise) return this.#startPromise;
    this.#state = "starting";
    const context = new DesktopApplicationStartContext();
    this.#startPromise = this.#run(initialize, context);
    return this.#startPromise;
  }

  async #run(
    initialize: (context: DesktopApplicationStartContext) => Promise<void>,
    context: DesktopApplicationStartContext,
  ): Promise<void> {
    try {
      await initialize(context);
      if (!context.committed) {
        throw new Error("Desktop startup returned before commit");
      }
      this.#state = "ready";
    } catch (error) {
      this.#state = "failed";
      this.#report(error);
      try {
        await context.rollback();
      } catch (rollbackError) {
        this.#report(rollbackError);
      }
      this.#options.exit(1);
      throw error;
    } finally {
      this.#startPromise = null;
    }
  }

  #report(error: unknown): void {
    try {
      this.#options.reportStartupError(error);
    } catch {
      // Startup failure handling must still reach rollback and non-zero exit.
    }
  }
}
