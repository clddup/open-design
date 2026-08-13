export function throwIfAgentGenerationAborted(
  signal: AbortSignal | undefined,
): void {
  if (!signal?.aborted) return;
  throw new DOMException("Design generation stopped", "AbortError");
}

const ANIMATION_FRAME_FALLBACK_MS = 250;

export async function waitForCanvasPaint(
  signal: AbortSignal | undefined,
  delayMs: number,
  onWait?: (durationMs: number, configuredDelayMs: number) => void,
): Promise<void> {
  const startedAt = performance.now();
  await waitForAnimationFrame(signal);
  await waitForAnimationFrame(signal);
  if (delayMs > 0) await waitForDelay(signal, delayMs);
  onWait?.(performance.now() - startedAt, delayMs);
}

function waitForAnimationFrame(signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const frame = { current: undefined as number | undefined };
    const fallback = { current: undefined as number | undefined };
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      if (fallback.current !== undefined) window.clearTimeout(fallback.current);
      resolve();
    };
    const abort = () => {
      if (settled) return;
      settled = true;
      if (frame.current !== undefined)
        window.cancelAnimationFrame(frame.current);
      if (fallback.current !== undefined) window.clearTimeout(fallback.current);
      reject(new DOMException("Design generation stopped", "AbortError"));
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    frame.current = window.requestAnimationFrame(finish);
    fallback.current = window.setTimeout(() => {
      if (frame.current !== undefined)
        window.cancelAnimationFrame(frame.current);
      finish();
    }, ANIMATION_FRAME_FALLBACK_MS);
  });
}

function waitForDelay(
  signal: AbortSignal | undefined,
  delayMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, delayMs);
    const abort = () => {
      window.clearTimeout(timeout);
      reject(new DOMException("Design generation stopped", "AbortError"));
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}
