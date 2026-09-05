import { afterEach, describe, expect, it, vi } from "vitest";
import { observeModelTransport } from "./model-provider-transport";

afterEach(() => vi.useRealTimers());

describe("model transport observation", () => {
  it("distinguishes no fetch, pending headers, and returned headers without reading the body", async () => {
    vi.useFakeTimers();
    const response = new Response("private response", { status: 200 });
    let resolve!: (response: Response) => void;
    const fetch = vi.fn<typeof globalThis.fetch>(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const transport = observeModelTransport(fetch);
    expect(transport.snapshot()).toEqual({
      fetchCalls: 0,
      firstFetchMs: null,
      latestFetchMs: null,
      latestHeadersMs: null,
      latestStatus: null,
    });
    await vi.advanceTimersByTimeAsync(10);
    const init = {
      headers: { authorization: "private-token" },
      body: "private prompt",
    };
    const pending = transport.fetch("https://provider.example/private", init);
    expect(fetch).toHaveBeenCalledWith(
      "https://provider.example/private",
      init,
    );
    expect(transport.snapshot()).toEqual({
      fetchCalls: 1,
      firstFetchMs: 10,
      latestFetchMs: 10,
      latestHeadersMs: null,
      latestStatus: null,
    });
    await vi.advanceTimersByTimeAsync(40);
    resolve(response);
    expect(await pending).toBe(response);
    expect(response.bodyUsed).toBe(false);
    expect(transport.snapshot()).toEqual({
      fetchCalls: 1,
      firstFetchMs: 10,
      latestFetchMs: 10,
      latestHeadersMs: 50,
      latestStatus: 200,
    });
  });

  it("does not attribute a late response from an earlier retry to the current fetch", async () => {
    const pending: ((response: Response) => void)[] = [];
    const transport = observeModelTransport(
      () => new Promise((resolve) => pending.push(resolve)),
    );
    const first = transport.fetch("https://provider.example");
    const second = transport.fetch("https://provider.example");
    pending[0](new Response(null, { status: 503 }));
    await first;
    expect(transport.snapshot().latestStatus).toBeNull();
    pending[1](new Response(null, { status: 200 }));
    await second;
    expect(transport.snapshot()).toMatchObject({
      fetchCalls: 2,
      latestStatus: 200,
    });
  });

  it("preserves rejection and isolates separate model requests", async () => {
    const error = new DOMException("Cancelled", "AbortError");
    const failed = observeModelTransport(() => Promise.reject(error));
    const untouched = observeModelTransport(globalThis.fetch);
    await expect(failed.fetch("https://provider.example")).rejects.toBe(error);
    expect(failed.snapshot()).toMatchObject({
      fetchCalls: 1,
      latestStatus: null,
    });
    expect(untouched.snapshot().fetchCalls).toBe(0);
  });
});
