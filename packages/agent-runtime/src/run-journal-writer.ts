import type { JournalEvent, SessionStore } from "@opendesign/session-store";

export interface RunJournalIdentity {
  runId: string;
  sessionId: string;
}

const storeAppendLocks = new WeakMap<
  SessionStore,
  Map<string, Promise<void>>
>();

/**
 * Appends one run-scoped journal event through the store's atomic allocator.
 *
 * Stores without appendNext are serialized per session as a compatibility
 * boundary. Both the current Runtime and the Pi migration path use this single
 * writer so a future cutover cannot create two sequence allocation policies.
 */
export async function appendRunJournalEvent(
  store: SessionStore,
  identity: RunJournalIdentity,
  type: JournalEvent["type"],
  payload: unknown,
  createdAt: string,
): Promise<number> {
  const createEvent = (sequence: number): JournalEvent => ({
    eventId: `${identity.runId}_event_${sequence}`,
    sessionId: identity.sessionId,
    runId: identity.runId,
    sequence,
    type,
    createdAt,
    payload,
  });
  if (store.appendNext !== undefined) {
    const event = await store.appendNext(identity.sessionId, createEvent);
    return event.sequence;
  }

  return serializeStoreAppend(store, identity.sessionId, async () => {
    const projection = await store.project(identity.sessionId);
    const event = createEvent(projection.lastSequence + 1);
    await store.append(event);
    return event.sequence;
  });
}

async function serializeStoreAppend<T>(
  store: SessionStore,
  sessionId: string,
  operation: () => Promise<T>,
): Promise<T> {
  let locks = storeAppendLocks.get(store);
  if (locks === undefined) {
    locks = new Map();
    storeAppendLocks.set(store, locks);
  }
  const previous = locks.get(sessionId) ?? Promise.resolve();
  const result = previous.then(operation);
  const queued = result.then(
    () => undefined,
    () => undefined,
  );
  locks.set(sessionId, queued);
  void queued.then(() => {
    if (locks?.get(sessionId) === queued) locks.delete(sessionId);
  });
  return result;
}
