export type ModelProviderTransportSample = {
  fetchCalls: number;
  firstFetchMs: number | null;
  latestFetchMs: number | null;
  latestHeadersMs: number | null;
  latestStatus: number | null;
};

/** Measures handoff to Fetch, not proof that an upstream server received it. */
export function observeModelTransport(fetch: typeof globalThis.fetch) {
  const startedAt = Date.now();
  const sample: ModelProviderTransportSample = {
    fetchCalls: 0,
    firstFetchMs: null,
    latestFetchMs: null,
    latestHeadersMs: null,
    latestStatus: null,
  };
  const elapsed = () => Math.max(0, Date.now() - startedAt);
  const observedFetch: typeof globalThis.fetch = async (input, init) => {
    const call = ++sample.fetchCalls;
    sample.firstFetchMs ??= elapsed();
    sample.latestFetchMs = elapsed();
    sample.latestHeadersMs = null;
    sample.latestStatus = null;
    const response = await fetch(input, init);
    // A late response from an aborted retry must not overwrite the current call.
    if (call === sample.fetchCalls) {
      sample.latestHeadersMs = elapsed();
      sample.latestStatus = response.status;
    }
    return response;
  };
  return { fetch: observedFetch, snapshot: () => ({ ...sample }) };
}
