import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionStoreRequestHandler } from "./agent-host.js";
import { AgentSessionStoreBinding } from "./agent-session-store-binding.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("AgentSessionStoreBinding", () => {
  it("binds a Main-owned store before Agent startup and releases the handler", async () => {
    const root = await mkdtemp(join(tmpdir(), "opendesign-agent-session-"));
    temporaryRoots.push(root);
    const setSessionStoreRequestHandler =
      vi.fn<(next: SessionStoreRequestHandler | null) => void>();
    const binding = new AgentSessionStoreBinding(
      { setSessionStoreRequestHandler },
      join(root, "events.jsonl"),
    );
    const registeredHandler = setSessionStoreRequestHandler.mock.calls[0]?.[0];

    expect(registeredHandler).not.toBeNull();
    if (!registeredHandler) throw new Error("Session Store handler is missing");
    await expect(
      registeredHandler(
        {
          type: "session-store.request",
          requestId: "read_1",
          operation: "read",
          sessionId: "conversation_1",
        },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ ok: true, operation: "read", result: [] });

    binding.dispose();
    binding.dispose();
    expect(setSessionStoreRequestHandler).toHaveBeenLastCalledWith(null);
    expect(setSessionStoreRequestHandler).toHaveBeenCalledTimes(2);
  });
});
