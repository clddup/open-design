import { JsonlSessionStore } from "@opendesign/session-store";
import type { AgentHost } from "./agent-host.js";
import { AgentSessionStoreHost } from "./agent-session-store-host.js";

type SessionStoreAgentHost = Pick<AgentHost, "setSessionStoreRequestHandler">;

/** Owns the mandatory Main-side Session Store bridge for one Agent lifecycle. */
export class AgentSessionStoreBinding {
  readonly store: JsonlSessionStore;
  readonly #agentHost: SessionStoreAgentHost;
  #disposed = false;

  constructor(agentHost: SessionStoreAgentHost, path: string) {
    this.#agentHost = agentHost;
    this.store = new JsonlSessionStore(path);
    const sessionStoreHost = new AgentSessionStoreHost(this.store);
    agentHost.setSessionStoreRequestHandler((request, signal) =>
      sessionStoreHost.execute(request, signal),
    );
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#agentHost.setSessionStoreRequestHandler(null);
  }
}
