export class ApplicationLifecycle {
  #quitRequested = false;

  markQuitRequested(): void {
    this.#quitRequested = true;
  }

  shouldQuitAfterLastWindow(platform: NodeJS.Platform): boolean {
    return this.#quitRequested || platform !== "darwin";
  }
}
