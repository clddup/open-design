import type { DiagnosticContext } from "@/shared/desktop-api";

export function rendererErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const message = error.message
    .replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, "")
    .trim();
  if (
    !message ||
    /(?:SQLITE_|UNIQUE constraint failed|FOREIGN KEY constraint failed)/i.test(
      message,
    )
  ) {
    return fallback;
  }
  return message;
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

export function reportRendererError(
  code: string,
  error: unknown,
  fallback: string,
  context?: DiagnosticContext,
  presentation: "silent" | "toast" = "toast",
  level: "warning" | "error" = "error",
): string {
  const message = rendererErrorMessage(error, fallback);
  void window.desktop
    ?.reportDiagnostic?.({
      level,
      presentation,
      code,
      message,
      ...(context ? { context } : {}),
    })
    .catch(() => undefined);
  return message;
}
