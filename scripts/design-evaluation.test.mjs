import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  loadDesignEvaluationScenarios,
  prepareBlindReviewBundle,
  scoreBlindReviewBundle,
  validateDesignEvaluationEvidence,
} from "./design-evaluation.mjs";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

describe("design evaluation", () => {
  it("loads the fixed UI and Logo scenarios", async () => {
    const scenarios = await loadDesignEvaluationScenarios(repositoryRoot);
    assert.deepEqual(
      scenarios.map((scenario) => scenario.id),
      ["OD-UI-01", "OD-LOGO-01", "OD-MARK-01"],
    );
  });

  it("prepares an anonymous packet and scores non-compensating ratings", async () => {
    const root = await mkdtemp(join(tmpdir(), "opendesign-evaluation-"));
    const evidenceA = await writeEvidence(root, "run_a", "1.0.0", "A");
    const evidenceB = await writeEvidence(root, "run_b", "2.0.0", "B");
    const bundle = join(root, "bundle");

    const prepared = await prepareBlindReviewBundle({
      root: repositoryRoot,
      evidenceRoots: [evidenceA, evidenceB],
      outputRoot: bundle,
      seed: "fixed-seed",
    });
    const packetText = await readFile(
      join(bundle, "review", "packet.json"),
      "utf8",
    );
    assert.equal(packetText.includes("run_a"), false);
    assert.equal(packetText.includes("provider_test"), false);
    assert.equal(packetText.includes("1.0.0"), false);
    assert.equal(prepared.packet.candidates.length, 2);

    const criteria = prepared.packet.scenario.criteria.map(
      (criterion) => criterion.id,
    );
    const labels = prepared.packet.candidates.map(
      (candidate) => candidate.label,
    );
    const ratings = {
      packetId: prepared.packet.packetId,
      reviews: [
        {
          reviewerId: "reviewer_1",
          scores: Object.fromEntries(
            labels.map((label, index) => [
              label,
              Object.fromEntries(
                criteria.map((criterionId) => [
                  criterionId,
                  index === 0 ? 4 : 3,
                ]),
              ),
            ]),
          ),
          preference: labels[0],
          notes: "Candidate preference is based on the fixed visible criteria.",
        },
      ],
    };
    const ratingsPath = join(root, "ratings.json");
    await writeFile(ratingsPath, `${JSON.stringify(ratings)}\n`, "utf8");

    const score = await scoreBlindReviewBundle({
      bundleRoot: bundle,
      ratingsPath,
    });
    assert.equal(score.reviewerCount, 1);
    assert.equal(score.candidates[0].passed, true);
    assert.equal(score.candidates[1].passed, false);
    assert.equal(score.candidates[0].preferenceCount, 1);
  });

  it("rejects evidence whose artifact hash is not reproducible", async () => {
    const root = await mkdtemp(join(tmpdir(), "opendesign-evaluation-hash-"));
    const evidence = await writeEvidence(root, "run_hash", "1.0.0", "hash");
    await writeFile(join(evidence, "target-one.jpg"), "tampered", "utf8");
    const scenarios = await loadDesignEvaluationScenarios(repositoryRoot);
    await assert.rejects(
      validateDesignEvaluationEvidence(evidence, scenarios),
      /hash mismatch/,
    );
  });

  it("rejects successful evidence without a passing final Critic per target", async () => {
    const root = await mkdtemp(join(tmpdir(), "opendesign-evaluation-critic-"));
    const evidence = await writeEvidence(root, "run_critic", "1.0.0", "critic");
    const evidencePath = join(evidence, "evidence.json");
    const report = JSON.parse(await readFile(evidencePath, "utf8"));
    report.critic = report.critic.slice(0, 1);
    await writeFile(
      evidencePath,
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    );
    const scenarios = await loadDesignEvaluationScenarios(repositoryRoot);
    await assert.rejects(
      validateDesignEvaluationEvidence(evidence, scenarios),
      /passing Critics/,
    );
  });

  it("rejects a single-mark fast run that exceeds its packaged benchmark budget", async () => {
    const root = await mkdtemp(join(tmpdir(), "opendesign-mark-budget-"));
    const evidence = await writeEvidence(root, "run_mark", "1.0.0", "mark", {
      scenarioId: "OD-MARK-01",
      generationMode: "fast",
      T1: 60_001,
      TAll: 300_000,
    });
    const scenarios = await loadDesignEvaluationScenarios(repositoryRoot);
    await assert.rejects(
      validateDesignEvaluationEvidence(evidence, scenarios),
      /exceeds performance budget/,
    );
  });
});

async function writeEvidence(root, runId, appVersion, marker, options = {}) {
  const directory = join(root, runId);
  await mkdir(directory, { recursive: true });
  const files = {
    "target-one.jpg": Buffer.from(`target-one-${marker}`),
    "target-two.jpg": Buffer.from(`target-two-${marker}`),
    "final.opendesign": Buffer.from(`{"marker":"${marker}"}\n`),
  };
  await Promise.all(
    Object.entries(files).map(([file, bytes]) =>
      writeFile(join(directory, file), bytes),
    ),
  );
  const targetIds =
    options.scenarioId === "OD-MARK-01"
      ? ["target-one"]
      : ["target-one", "target-two"];
  const report = {
    scenarioId: options.scenarioId ?? "OD-UI-01",
    runId,
    platform: "darwin",
    appVersion,
    generationMode: options.generationMode ?? "thorough",
    model: {
      providerId: "provider_test",
      modelId: "model-test",
      reasoningEffort: "medium",
      contextWindow: 200000,
      maxOutputTokens: 16384,
    },
    protocol: {
      initialProtocolCharacters: 29000,
      initialToolNames: [
        "opendesign_generate_first_slice",
        "opendesign_inspect_document",
      ],
    },
    terminal: "completed",
    success: true,
    performance: {
      terminal: "completed",
      targetCount: targetIds.length,
      milestonesMs: {
        T_plan: 100,
        T0: 100,
        T1: options.T1 ?? 200,
        T2: Math.max(400, (options.T1 ?? 200) + 100),
        T_all: options.TAll ?? 600,
        firstReviewed: Math.max(300, (options.T1 ?? 200) + 50),
      },
    },
    captures: targetIds.map((targetId, index) =>
      capture(
        targetId,
        `${targetId}.jpg`,
        files[`${targetId}.jpg`],
        index === 0 ? 2 : 5,
      ),
    ),
    finalDocument: {
      file: "final.opendesign",
      sha256: sha256(files["final.opendesign"]),
    },
    critic: targetIds.map(critic),
    failure: null,
  };
  await writeFile(
    join(directory, "evidence.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  return directory;
}

function capture(targetId, file, bytes, revision) {
  return {
    targetId,
    phase: "final",
    revision,
    file,
    width: 1440,
    height: 900,
    sha256: sha256(bytes),
  };
}

function critic(targetId) {
  return {
    targetId,
    phase: "final",
    passed: true,
    averageScore: 4,
    failedCriteria: [],
    criteria: {
      "craft-precision": {
        score: 4,
        evidence: "The final capture has consistent visible spacing.",
      },
    },
  };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
