export function throwIfAgentGenerationAborted(
  signal: AbortSignal | undefined,
): void {
  if (!signal?.aborted) return;
  throw new DOMException("Design generation stopped", "AbortError");
}

export async function waitForCanvasPaint(
  signal: AbortSignal | undefined,
  delayMs: number,
): Promise<void> {
  await waitForAnimationFrame(signal);
  await waitForAnimationFrame(signal);
  if (delayMs <= 0) return;
  await waitForDelay(signal, delayMs);
}

function waitForAnimationFrame(signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const frame = { current: undefined as number | undefined };
    const finish = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const abort = () => {
      if (frame.current !== undefined)
        window.cancelAnimationFrame(frame.current);
      reject(new DOMException("Design generation stopped", "AbortError"));
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    frame.current = window.requestAnimationFrame(finish);
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
