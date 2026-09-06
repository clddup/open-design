/** Stop awaiting an operation; its underlying work may not itself support abort. */
export function awaitAbortable<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", abort);
    const abort = () => {
      cleanup();
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new DOMException("Operation cancelled", "AbortError"),
      );
    };
    // Always observe rejection, even if cancellation happened during creation.
    void operation.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}
