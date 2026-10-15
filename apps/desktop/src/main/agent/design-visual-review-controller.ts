import { createHash } from "node:crypto";
import { designWorkflowError } from "@/shared/design-workflow-failure-classification.js";
import type {
  DesignVisualCriticContext,
  DesignVisualCriticResult,
} from "./design-visual-critic.js";

type CriticOperation = () => Promise<DesignVisualCriticResult>;
type ReviewEntry = {
  result: Promise<DesignVisualCriticResult>;
  reuses: number;
};
type TargetBudget = {
  completed: number;
  stagnant: number;
  bestScores: Map<string, number>;
};
type RunReviews = {
  entries: Map<string, ReviewEntry>;
  targets: Map<string, TargetBudget>;
};

const MAX_COMPLETED_REVIEWS = 6;
const MAX_STAGNANT_REVIEWS = 3;

/** Disposable Main-owned opinions, never a document or verified-revision store. */
export class DesignVisualReviewController {
  readonly #runs = new Map<string, RunReviews>();

  async review(
    documentId: string,
    context: DesignVisualCriticContext,
    signal: AbortSignal,
    execute: CriticOperation,
  ): Promise<DesignVisualCriticResult> {
    signal.throwIfAborted();
    const run = this.#run(context.runId);
    const key = evidenceIdentity(documentId, context);
    const existing = run.entries.get(key);
    if (existing) {
      if (existing.reuses >= 1) throw reviewLimit("identical-evidence");
      existing.reuses++;
      const result = await existing.result;
      this.#assertActive(context.runId, run, signal);
      return structuredClone(result);
    }
    const targetKey = JSON.stringify([documentId, context.target.targetId]);
    const budget = run.targets.get(targetKey) ?? newTargetBudget();
    if (
      budget.stagnant >= MAX_STAGNANT_REVIEWS ||
      budget.completed >= MAX_COMPLETED_REVIEWS
    ) {
      throw reviewLimit("no-improvement");
    }
    run.targets.set(targetKey, budget);
    const entry: ReviewEntry = {
      result: Promise.resolve().then(() => {
        this.#assertActive(context.runId, run, signal);
        return execute();
      }),
      reuses: 0,
    };
    run.entries.set(key, entry);
    return this.#completeReview(context.runId, run, key, entry, budget, signal);
  }

  async #completeReview(
    runId: string,
    run: RunReviews,
    key: string,
    entry: ReviewEntry,
    budget: TargetBudget,
    signal: AbortSignal,
  ): Promise<DesignVisualCriticResult> {
    try {
      const result = await entry.result;
      this.#assertActive(runId, run, signal);
      recordVerdict(budget, result);
      return structuredClone(result);
    } catch (error) {
      run.entries.delete(key);
      throw error;
    }
  }

  disposeRun(runId: string): void {
    this.#runs.delete(runId);
  }

  #run(runId: string): RunReviews {
    const existing = this.#runs.get(runId);
    if (existing) return existing;
    const run: RunReviews = { entries: new Map(), targets: new Map() };
    this.#runs.set(runId, run);
    return run;
  }

  #assertActive(runId: string, run: RunReviews, signal: AbortSignal): void {
    signal.throwIfAborted();
    if (this.#runs.get(runId) !== run) {
      throw new DOMException("Visual review Run was disposed", "AbortError");
    }
  }
}

function evidenceIdentity(
  documentId: string,
  context: DesignVisualCriticContext,
): string {
  const serialized = JSON.stringify(
    [documentId, context],
    (_key: string, value: unknown): unknown => {
      if (value === null || typeof value !== "object" || Array.isArray(value))
        return value;
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, (value as Record<string, unknown>)[key]]),
      );
    },
  );
  return createHash("sha256").update(serialized).digest("hex");
}

function newTargetBudget(): TargetBudget {
  return { completed: 0, stagnant: 0, bestScores: new Map() };
}

function recordVerdict(
  budget: TargetBudget,
  result: DesignVisualCriticResult,
): void {
  let improved = false;
  for (const [criterion, finding] of Object.entries(result.criteria)) {
    if (!finding) continue;
    const best = budget.bestScores.get(criterion);
    if (best !== undefined && finding.score > best) improved = true;
    budget.bestScores.set(
      criterion,
      Math.max(best ?? finding.score, finding.score),
    );
  }
  budget.completed++;
  budget.stagnant = result.passed ? 0 : improved ? 1 : budget.stagnant + 1;
}

function reviewLimit(reason: "identical-evidence" | "no-improvement"): Error {
  const identical = reason === "identical-evidence";
  return designWorkflowError(
    "visual_review_no_progress",
    identical
      ? "This exact target, revision and review evidence has already been evaluated and reused."
      : "Independent review reached the per-target limit without sufficient improvement.",
    {
      path: identical ? "/capture/revision" : "/visualReview",
      recovery: identical
        ? "Use the existing findings. If refinement is needed, make a concrete edit before capturing again; otherwise report the actual reviewed status. Do not repeat capture for unchanged evidence."
        : "Preserve the committed design and report the latest findings and review limit. Ordinary edits and other targets remain available; a new user Run can review this target again. Do not retry this target's critic in this Run.",
    },
  );
}
