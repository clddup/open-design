const DESIGN_STEP_PROGRESS_PREFIX = "设计步骤：";

export function designStepProgressMessage(
  label: string,
  revision: number,
): string {
  return `${DESIGN_STEP_PROGRESS_PREFIX}${label} · r${revision}`;
}

export function parseDesignStepProgressMessage(
  value: string,
): { label: string; revision: number } | null {
  if (!value.startsWith(DESIGN_STEP_PROGRESS_PREFIX)) return null;
  const match = /^(.*) · r(\d+)$/.exec(
    value.slice(DESIGN_STEP_PROGRESS_PREFIX.length),
  );
  if (!match?.[1] || match[1].length > 512) return null;
  const revision = Number(match[2]);
  return Number.isSafeInteger(revision) ? { label: match[1], revision } : null;
}
