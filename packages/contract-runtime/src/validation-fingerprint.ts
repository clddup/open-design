/** Values belong in diagnostics; changing a wrong value is not a new root cause. */
export function validationFailureFingerprint(
  subject: string,
  issues: readonly { code?: string; path: string }[],
): string {
  const first = issues[0];
  return ["validation", subject, first?.code ?? "invalid", first?.path || "/"]
    .join(":")
    .slice(0, 256);
}
