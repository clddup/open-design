export interface PreventableApplicationEvent {
  preventDefault(): void;
}

export interface ApplicationShutdownResources {
  abortActiveWork(): Promise<void> | void;
  clearCorrelations(): Promise<void> | void;
  clearServices(): Promise<void> | void;
  closeWorkspace(): Promise<void> | void;
  detachAgentHandlers(): Promise<void> | void;
  flushDiagnostics(): Promise<void> | void;
  rejectRendererTools(): Promise<void> | void;
  stopAgent(): Promise<void> | void;
}

export interface ApplicationLifecycleOptions {
  exit(code: number): void;
  platform: NodeJS.Platform;
  quit(): void;
  reportShutdownError(error: unknown): void;
  resources: ApplicationShutdownResources;
}

export class ApplicationLifecycle {
  readonly #options: ApplicationLifecycleOptions;
  #quitRequested = false;
  #shutdownPromise: Promise<void> | null = null;

  constructor(options: ApplicationLifecycleOptions) {
    this.#options = options;
  }

  handleBeforeQuit(): void {
    this.#quitRequested = true;
  }

  handleWindowAllClosed(): void {
    if (this.#quitRequested || this.#options.platform !== "darwin") {
      this.#options.quit();
    }
  }

  handleWillQuit(event: PreventableApplicationEvent): Promise<void> {
    // Electron does not await event listeners. Hold termination once, perform
    // the ordered asynchronous teardown, then use app.exit after every
    // resource has had a chance to release or flush.
    event.preventDefault();
    this.#shutdownPromise ??= this.#shutdownAndExit();
    return this.#shutdownPromise;
  }

  async #shutdownAndExit(): Promise<void> {
    try {
      await this.#shutdownResources();
    } catch (error) {
      this.#options.reportShutdownError(error);
    } finally {
      this.#options.exit(0);
    }
  }

  async #shutdownResources(): Promise<void> {
    const failures: Error[] = [];
    const steps: Array<readonly [string, () => Promise<void> | void]> = [
      ["abort active work", () => this.#options.resources.abortActiveWork()],
      ["stop Agent", () => this.#options.resources.stopAgent()],
      [
        "detach Agent handlers",
        () => this.#options.resources.detachAgentHandlers(),
      ],
      [
        "reject Renderer tools",
        () => this.#options.resources.rejectRendererTools(),
      ],
      ["close Workspace", () => this.#options.resources.closeWorkspace()],
      ["clear correlations", () => this.#options.resources.clearCorrelations()],
      ["flush diagnostics", () => this.#options.resources.flushDiagnostics()],
      ["clear services", () => this.#options.resources.clearServices()],
    ];
    for (const [label, step] of steps) {
      try {
        await step();
      } catch (error) {
        failures.push(
          new Error(
            `${label}: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          ),
        );
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, "OpenDesign shutdown was incomplete");
    }
  }
}
