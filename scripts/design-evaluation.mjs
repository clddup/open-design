import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(scriptPath), "..");
const manifestPath = "fixtures/design-evaluation/manifest.json";
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
const ARTIFACT_FILE_PATTERN =
  /^[A-Za-z0-9._-]+\.(jpg|jpeg|png|webp|opendesign)$/i;

export async function loadDesignEvaluationScenarios(root = repositoryRoot) {
  const manifest = await readJson(resolve(root, manifestPath));
  if (!record(manifest) || !onlyKeys(manifest, ["scenarios"])) {
    throw new TypeError("Invalid design evaluation manifest");
  }
  if (!Array.isArray(manifest.scenarios) || manifest.scenarios.length < 2) {
    throw new TypeError(
      "Design evaluation requires fixed UI and Logo scenarios",
    );
  }
  const scenarios = [];
  const ids = new Set();
  for (const value of manifest.scenarios) {
    const scenario = await validateScenario(value, root);
    if (ids.has(scenario.id)) {
      throw new TypeError(
        `Duplicate design evaluation scenario: ${scenario.id}`,
      );
    }
    ids.add(scenario.id);
    scenarios.push(scenario);
  }
  if (
    !ids.has("OD-UI-01") ||
    !ids.has("OD-LOGO-01") ||
    !ids.has("OD-MARK-01")
  ) {
    throw new TypeError(
      "Design evaluation must include OD-UI-01, OD-LOGO-01 and OD-MARK-01",
    );
  }
  return scenarios;
}

export async function validateDesignEvaluationEvidence(
  evidenceRoot,
  scenarios,
) {
  const root = resolve(evidenceRoot);
  const report = await readJson(resolve(root, "evidence.json"));
  if (!record(report))
    throw new TypeError("Invalid design evaluation evidence");
  const scenario = scenarios.find(
    (candidate) => candidate.id === report.scenarioId,
  );
  if (!scenario) {
    throw new TypeError(
      `Unknown design evaluation scenario: ${report.scenarioId}`,
    );
  }
  validateEvidenceShape(report, scenario);
  await Promise.all(
    report.captures.map((capture) => verifyArtifact(root, capture)),
  );
  if (report.finalDocument !== null) {
    await verifyArtifact(root, report.finalDocument);
  }
  return { report, root, scenario };
}

export async function prepareBlindReviewBundle({
  root = repositoryRoot,
  evidenceRoots,
  outputRoot,
  seed,
}) {
  if (!Array.isArray(evidenceRoots) || evidenceRoots.length < 2) {
    throw new Error("Blind review requires at least two evidence directories");
  }
  if (!safeText(seed, 256)) throw new TypeError("Blind review seed is invalid");
  const scenarios = await loadDesignEvaluationScenarios(root);
  const evidence = await Promise.all(
    evidenceRoots.map((candidate) =>
      validateDesignEvaluationEvidence(candidate, scenarios),
    ),
  );
  const scenario = evidence[0].scenario;
  if (evidence.some((candidate) => candidate.scenario.id !== scenario.id)) {
    throw new Error("Blind review candidates must use the same fixed scenario");
  }
  if (evidence.some((candidate) => !candidate.report.success)) {
    throw new Error(
      "Blind review candidates require successful final evidence",
    );
  }
  const modelIdentity = canonicalJson(evidence[0].report.model);
  if (
    evidence.some(
      (candidate) => canonicalJson(candidate.report.model) !== modelIdentity,
    )
  ) {
    throw new Error(
      "Blind review candidates must use the same model and context budget",
    );
  }
  const runIds = new Set(evidence.map((candidate) => candidate.report.runId));
  if (runIds.size !== evidence.length) {
    throw new Error("Blind review candidates must use distinct Run IDs");
  }
  if (evidence.length > 26) {
    throw new Error("Blind review supports at most 26 candidates");
  }

  const output = resolve(outputRoot);
  await requireEmptyDirectory(output);
  const reviewRoot = join(output, "review");
  const assetsRoot = join(reviewRoot, "assets");
  await mkdir(assetsRoot, { recursive: true });

  const ordered = [...evidence].sort((left, right) =>
    sha256(`${seed}:${left.report.runId}`).localeCompare(
      sha256(`${seed}:${right.report.runId}`),
    ),
  );
  const candidates = [];
  const mappings = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const candidate = ordered[index];
    const label = `Candidate ${alphabeticLabel(index)}`;
    const directory = join(
      assetsRoot,
      `candidate-${alphabeticLabel(index).toLowerCase()}`,
    );
    await mkdir(directory, { recursive: true });
    const finalCaptures = candidate.report.captures
      .filter((capture) => capture.phase === "final")
      .sort((left, right) => left.targetId.localeCompare(right.targetId));
    const artboards = [];
    for (
      let captureIndex = 0;
      captureIndex < finalCaptures.length;
      captureIndex += 1
    ) {
      const capture = finalCaptures[captureIndex];
      const extension = capture.file.split(".").at(-1).toLowerCase();
      const file = `artboard-${String(captureIndex + 1).padStart(2, "0")}.${extension}`;
      await copyFile(join(candidate.root, capture.file), join(directory, file));
      artboards.push({
        index: captureIndex + 1,
        file: `assets/${basename(directory)}/${file}`,
        width: capture.width,
        height: capture.height,
      });
    }
    candidates.push({ label, artboards });
    mappings.push({
      label,
      runId: candidate.report.runId,
      appVersion: candidate.report.appVersion,
      platform: candidate.report.platform,
      protocol: candidate.report.protocol,
      evidenceFingerprint: evidenceFingerprint(candidate.report),
    });
  }
  const prompt = await readBoundedText(resolveWithin(root, scenario.prompt));
  const packetId = sha256(
    canonicalJson({
      seed,
      scenarioId: scenario.id,
      candidates: mappings.map((mapping) => mapping.evidenceFingerprint),
    }),
  );
  const packet = {
    packetId,
    scenario: {
      id: scenario.id,
      title: scenario.title,
      prompt,
      expectedTargetCount: scenario.expectedTargetCount,
      criteria: scenario.criteria,
    },
    instructions: {
      scoreRange: [1, 5],
      criticalThreshold: 4,
      ordinaryThreshold: 3,
      rule: "Score every criterion independently from visible evidence. Strong criteria cannot compensate for a criterion below its threshold.",
    },
    candidates,
  };
  const key = { packetId, scenarioId: scenario.id, mappings };
  await Promise.all([
    writeJson(join(reviewRoot, "packet.json"), packet),
    writeJson(join(output, "key.json"), key),
  ]);
  return { packet, key };
}

export async function scoreBlindReviewBundle({ bundleRoot, ratingsPath }) {
  const root = resolve(bundleRoot);
  const [packet, key, ratings] = await Promise.all([
    readJson(join(root, "review", "packet.json")),
    readJson(join(root, "key.json")),
    readJson(resolve(ratingsPath)),
  ]);
  validatePacketAndKey(packet, key);
  validateRatings(ratings, packet);
  const mappingByLabel = new Map(
    key.mappings.map((mapping) => [mapping.label, mapping]),
  );
  const candidates = packet.candidates.map((candidate) => {
    const criteria = packet.scenario.criteria.map((criterion) => {
      const scores = ratings.reviews.map(
        (review) => review.scores[candidate.label][criterion.id],
      );
      const average = round(
        scores.reduce((total, score) => total + score, 0) / scores.length,
      );
      const threshold = criterion.critical ? 4 : 3;
      return {
        criterionId: criterion.id,
        average,
        threshold,
        passed: average >= threshold,
      };
    });
    return {
      ...mappingByLabel.get(candidate.label),
      label: candidate.label,
      averageScore: round(
        criteria.reduce((total, criterion) => total + criterion.average, 0) /
          criteria.length,
      ),
      passed: criteria.every((criterion) => criterion.passed),
      criteria,
      preferenceCount: ratings.reviews.filter(
        (review) => review.preference === candidate.label,
      ).length,
    };
  });
  const result = {
    packetId: packet.packetId,
    scenarioId: packet.scenario.id,
    reviewerCount: ratings.reviews.length,
    tieCount: ratings.reviews.filter((review) => review.preference === "tie")
      .length,
    candidates,
  };
  await writeJson(join(root, "score.json"), result);
  return result;
}

async function validateScenario(value, root) {
  if (
    !record(value) ||
    !onlyKeys(value, [
      "id",
      "title",
      "deliverable",
      "generationMode",
      "prompt",
      "expectedTargetCount",
      "modelContext",
      "initialSurface",
      "requiredMilestones",
      ...(value.performanceBudgetMs === undefined
        ? []
        : ["performanceBudgetMs"]),
      "criteria",
    ]) ||
    !safeId(value.id, 64) ||
    !/^OD-(UI|LOGO|MARK)-\d{2}$/.test(value.id) ||
    !safeText(value.title, 256) ||
    !["ui", "logo"].includes(value.deliverable) ||
    !["fast", "thorough"].includes(value.generationMode) ||
    !positiveInteger(value.expectedTargetCount, 32) ||
    !validModelContext(value.modelContext) ||
    !validInitialSurface(value.initialSurface) ||
    !Array.isArray(value.requiredMilestones) ||
    canonicalJson(value.requiredMilestones) !==
      canonicalJson(["T_plan", "T0", "T1", "T2", "T_all"]) ||
    (value.performanceBudgetMs !== undefined &&
      !validPerformanceBudget(value.performanceBudgetMs)) ||
    !Array.isArray(value.criteria) ||
    value.criteria.length < 6 ||
    value.criteria.length > 16
  ) {
    throw new TypeError(
      `Invalid design evaluation scenario: ${value?.id ?? "unknown"}`,
    );
  }
  const criterionIds = new Set();
  for (const criterion of value.criteria) {
    if (
      !record(criterion) ||
      !onlyKeys(criterion, ["id", "label", "critical", "description"]) ||
      !safeId(criterion.id, 128) ||
      criterionIds.has(criterion.id) ||
      !safeText(criterion.label, 256) ||
      typeof criterion.critical !== "boolean" ||
      !safeText(criterion.description, 1_000)
    ) {
      throw new TypeError(`Invalid evaluation criterion in ${value.id}`);
    }
    criterionIds.add(criterion.id);
  }
  if (!safeRelativePath(value.prompt)) {
    throw new TypeError(`Invalid prompt path in ${value.id}`);
  }
  await readBoundedText(resolveWithin(root, value.prompt));
  return cloneJson(value);
}

function validateEvidenceShape(value, scenario) {
  if (
    !onlyKeys(value, [
      "scenarioId",
      "runId",
      "platform",
      "appVersion",
      "model",
      "generationMode",
      "protocol",
      "terminal",
      "success",
      "performance",
      "captures",
      "finalDocument",
      "critic",
      "failure",
    ]) ||
    value.scenarioId !== scenario.id ||
    !safeId(value.runId, 256) ||
    !["darwin", "win32"].includes(value.platform) ||
    !safeText(value.appVersion, 128) ||
    value.generationMode !== scenario.generationMode ||
    !validModel(value.model, scenario.modelContext) ||
    !validProtocol(value.protocol, scenario.initialSurface) ||
    !["completed", "error"].includes(value.terminal) ||
    typeof value.success !== "boolean" ||
    !validPerformance(value.performance, scenario, value.terminal) ||
    !Array.isArray(value.captures) ||
    value.captures.length > 64 ||
    !value.captures.every(validCapture) ||
    !Array.isArray(value.critic) ||
    value.critic.length > 128 ||
    !value.critic.every(validCriticRecord)
  ) {
    throw new TypeError(
      `Invalid design evaluation evidence: ${value.scenarioId}`,
    );
  }
  if (value.success) {
    if (
      value.terminal !== "completed" ||
      !validArtifact(value.finalDocument, "opendesign") ||
      value.failure !== null
    ) {
      throw new TypeError(
        "Successful evidence requires a final document and no failure",
      );
    }
    const finalCaptures = value.captures.filter(
      (capture) => capture.phase === "final",
    );
    const finalCritics = value.critic.filter(
      (critic) => critic.phase === "final",
    );
    const finalTargetIds = finalCaptures
      .map((capture) => capture.targetId)
      .sort();
    if (
      finalCaptures.length !== scenario.expectedTargetCount ||
      new Set(finalTargetIds).size !== finalCaptures.length ||
      finalCritics.length !== scenario.expectedTargetCount ||
      finalCritics.some((critic) => !critic.passed) ||
      canonicalJson(finalCritics.map((critic) => critic.targetId).sort()) !==
        canonicalJson(finalTargetIds) ||
      scenario.requiredMilestones.some(
        (milestone) => value.performance.milestonesMs[milestone] === null,
      )
    ) {
      throw new TypeError(
        "Successful evidence is missing final targets, passing Critics, or milestones",
      );
    }
    const orderedMilestones = scenario.requiredMilestones.map(
      (milestone) => value.performance.milestonesMs[milestone],
    );
    if (
      orderedMilestones.some(
        (item, index) => index > 0 && item < orderedMilestones[index - 1],
      )
    ) {
      throw new TypeError("Successful evidence milestones are not monotonic");
    }
    if (
      scenario.performanceBudgetMs !== undefined &&
      (value.performance.milestonesMs.T1 > scenario.performanceBudgetMs.T1 ||
        value.performance.milestonesMs.T_all >
          scenario.performanceBudgetMs.T_all)
    ) {
      throw new TypeError("Successful evidence exceeds performance budget");
    }
    return;
  }
  if (
    value.finalDocument !== null ||
    !record(value.failure) ||
    !onlyKeys(value.failure, ["code", "message"]) ||
    !safeId(value.failure.code, 256) ||
    !safeText(value.failure.message, 4_000)
  ) {
    throw new TypeError("Failed evidence requires one bounded failure");
  }
}

function validModel(value, expected) {
  return (
    record(value) &&
    onlyKeys(value, [
      "providerId",
      "modelId",
      "reasoningEffort",
      "contextWindow",
      "maxOutputTokens",
    ]) &&
    safeId(value.providerId, 256) &&
    safeText(value.modelId, 256) &&
    value.reasoningEffort === expected.reasoningEffort &&
    value.contextWindow === expected.contextWindow &&
    value.maxOutputTokens === expected.maxOutputTokens
  );
}

function validProtocol(value, expected) {
  return (
    record(value) &&
    onlyKeys(value, ["initialProtocolCharacters", "initialToolNames"]) &&
    nonNegativeInteger(value.initialProtocolCharacters) &&
    value.initialProtocolCharacters <= expected.maxProtocolCharacters &&
    Array.isArray(value.initialToolNames) &&
    canonicalJson([...value.initialToolNames].sort()) ===
      canonicalJson([...expected.toolNames].sort())
  );
}

function validPerformance(value, scenario, terminal) {
  const milestoneNames = ["T_plan", "T0", "T1", "T2", "T_all", "firstReviewed"];
  if (
    !record(value) ||
    !onlyKeys(value, ["terminal", "targetCount", "milestonesMs"]) ||
    JSON.stringify(value).length > 100_000 ||
    value.terminal !== terminal ||
    value.targetCount !== scenario.expectedTargetCount ||
    !record(value.milestonesMs) ||
    !onlyKeys(value.milestonesMs, milestoneNames)
  ) {
    return false;
  }
  for (const milestone of milestoneNames) {
    const candidate = value.milestonesMs[milestone];
    if (!(candidate === null || nonNegativeInteger(candidate))) return false;
  }
  return true;
}

function validPerformanceBudget(value) {
  return (
    record(value) &&
    onlyKeys(value, ["T1", "T_all"]) &&
    positiveInteger(value.T1, 86_400_000) &&
    positiveInteger(value.T_all, 86_400_000) &&
    value.T_all >= value.T1
  );
}

function validCapture(value) {
  return (
    record(value) &&
    onlyKeys(value, [
      "targetId",
      "phase",
      "revision",
      "file",
      "width",
      "height",
      "sha256",
    ]) &&
    safeId(value.targetId, 256) &&
    ["draft", "final"].includes(value.phase) &&
    nonNegativeInteger(value.revision) &&
    validArtifact(value, "image") &&
    positiveInteger(value.width, 100_000) &&
    positiveInteger(value.height, 100_000)
  );
}

function validArtifact(value, kind) {
  return (
    record(value) &&
    (kind === "image" || onlyKeys(value, ["file", "sha256"])) &&
    typeof value.file === "string" &&
    ARTIFACT_FILE_PATTERN.test(value.file) &&
    basename(value.file) === value.file &&
    SHA256_PATTERN.test(String(value.sha256)) &&
    (kind === "image"
      ? /\.(jpg|jpeg|png|webp)$/i.test(value.file)
      : value.file.endsWith(".opendesign"))
  );
}

function validCriticRecord(value) {
  if (
    !record(value) ||
    !onlyKeys(value, [
      "targetId",
      "phase",
      "passed",
      "averageScore",
      "failedCriteria",
      "criteria",
    ]) ||
    !safeId(value.targetId, 256) ||
    !["draft", "final"].includes(value.phase) ||
    typeof value.passed !== "boolean" ||
    !finiteScore(value.averageScore) ||
    !Array.isArray(value.failedCriteria) ||
    value.failedCriteria.length > 32 ||
    !value.failedCriteria.every((criterion) => safeId(criterion, 128)) ||
    !record(value.criteria) ||
    Object.keys(value.criteria).length > 32
  ) {
    return false;
  }
  return Object.entries(value.criteria).every(
    ([criterionId, criterion]) =>
      safeId(criterionId, 128) &&
      record(criterion) &&
      onlyKeys(criterion, [
        "score",
        "evidence",
        ...(criterion.refinement === undefined ? [] : ["refinement"]),
      ]) &&
      finiteScore(criterion.score) &&
      safeText(criterion.evidence, 4_000) &&
      (criterion.refinement === undefined ||
        safeText(criterion.refinement, 4_000)),
  );
}

async function verifyArtifact(root, artifact) {
  const path = resolveWithin(root, artifact.file);
  const bytes = await readBounded(path, MAX_ARTIFACT_BYTES);
  if (sha256(bytes) !== artifact.sha256) {
    throw new Error(
      `Design evaluation artifact hash mismatch: ${artifact.file}`,
    );
  }
}

function validatePacketAndKey(packet, key) {
  if (
    !record(packet) ||
    !record(key) ||
    !safeId(packet.packetId, 64) ||
    packet.packetId !== key.packetId ||
    !record(packet.scenario) ||
    !Array.isArray(packet.scenario.criteria) ||
    !Array.isArray(packet.candidates) ||
    !Array.isArray(key.mappings) ||
    packet.candidates.length !== key.mappings.length ||
    packet.scenario.id !== key.scenarioId
  ) {
    throw new TypeError("Invalid blind review packet or identity key");
  }
  const labels = packet.candidates.map((candidate) => candidate.label);
  if (
    new Set(labels).size !== labels.length ||
    canonicalJson(labels) !==
      canonicalJson(key.mappings.map((mapping) => mapping.label))
  ) {
    throw new TypeError("Blind review candidate mapping does not match packet");
  }
}

function validateRatings(value, packet) {
  if (
    !record(value) ||
    !onlyKeys(value, ["packetId", "reviews"]) ||
    value.packetId !== packet.packetId ||
    !Array.isArray(value.reviews) ||
    value.reviews.length < 1 ||
    value.reviews.length > 64
  ) {
    throw new TypeError("Invalid blind review ratings");
  }
  const labels = packet.candidates.map((candidate) => candidate.label);
  const criterionIds = packet.scenario.criteria.map(
    (criterion) => criterion.id,
  );
  const reviewers = new Set();
  for (const review of value.reviews) {
    if (
      !record(review) ||
      !onlyKeys(review, [
        "reviewerId",
        "scores",
        "preference",
        ...(review.notes === undefined ? [] : ["notes"]),
      ]) ||
      !safeId(review.reviewerId, 128) ||
      reviewers.has(review.reviewerId) ||
      !record(review.scores) ||
      ![...labels, "tie"].includes(review.preference) ||
      !(review.notes === undefined || safeText(review.notes, 4_000)) ||
      canonicalJson(Object.keys(review.scores).sort()) !==
        canonicalJson([...labels].sort())
    ) {
      throw new TypeError("Invalid blind review entry");
    }
    reviewers.add(review.reviewerId);
    for (const label of labels) {
      const scores = review.scores[label];
      if (
        !record(scores) ||
        canonicalJson(Object.keys(scores).sort()) !==
          canonicalJson([...criterionIds].sort()) ||
        Object.values(scores).some(
          (score) => !Number.isInteger(score) || score < 1 || score > 5,
        )
      ) {
        throw new TypeError("Blind review scores must cover every criterion");
      }
    }
  }
}

function evidenceFingerprint(report) {
  return sha256(
    canonicalJson({
      scenarioId: report.scenarioId,
      runId: report.runId,
      protocol: report.protocol,
      finalDocument: report.finalDocument,
      finalCaptures: report.captures.filter(
        (capture) => capture.phase === "final",
      ),
    }),
  );
}

function validModelContext(value) {
  return (
    record(value) &&
    onlyKeys(value, ["contextWindow", "maxOutputTokens", "reasoningEffort"]) &&
    positiveInteger(value.contextWindow, 10_000_000) &&
    positiveInteger(value.maxOutputTokens, 1_000_000) &&
    ["low", "medium", "high"].includes(value.reasoningEffort)
  );
}

function validInitialSurface(value) {
  return (
    record(value) &&
    onlyKeys(value, ["toolNames", "maxProtocolCharacters"]) &&
    Array.isArray(value.toolNames) &&
    value.toolNames.length >= 1 &&
    value.toolNames.length <= 16 &&
    new Set(value.toolNames).size === value.toolNames.length &&
    value.toolNames.every((toolName) => safeId(toolName, 256)) &&
    positiveInteger(value.maxProtocolCharacters, 1_000_000)
  );
}

async function requireEmptyDirectory(path) {
  await mkdir(path, { recursive: true });
  const entries = await readdir(path);
  if (entries.length > 0) {
    throw new Error(`Blind review output directory must be empty: ${path}`);
  }
}

async function readJson(path) {
  return JSON.parse(await readBoundedText(path));
}

async function readBoundedText(path) {
  const bytes = await readBounded(path, MAX_JSON_BYTES);
  return bytes.toString("utf8");
}

async function readBounded(path, maximum) {
  const bytes = await readFile(path);
  if (bytes.byteLength === 0 || bytes.byteLength > maximum) {
    throw new Error(`Design evaluation file size is invalid: ${path}`);
  }
  return bytes;
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function resolveWithin(root, path) {
  const base = resolve(root);
  const target = resolve(base, path);
  const pathRelative = relative(base, target);
  if (
    pathRelative === ".." ||
    pathRelative.startsWith(`..${sep}`) ||
    isAbsolute(pathRelative)
  ) {
    throw new Error(`Design evaluation path escapes its root: ${path}`);
  }
  return target;
}

function safeRelativePath(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    !isAbsolute(value) &&
    !value.split(/[\\/]/).includes("..")
  );
}

function safeId(value, maximum) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    SAFE_ID_PATTERN.test(value)
  );
}

function safeText(value, maximum) {
  return (
    typeof value === "string" && value.length > 0 && value.length <= maximum
  );
}

function positiveInteger(value, maximum) {
  return Number.isInteger(value) && value > 0 && value <= maximum;
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function finiteScore(value) {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 1 &&
    value <= 5
  );
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function onlyKeys(value, keys) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (record(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function alphabeticLabel(index) {
  if (!Number.isInteger(index) || index < 0 || index >= 26) {
    throw new RangeError("Blind review supports at most 26 candidates");
  }
  return String.fromCharCode(65 + index);
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

async function main() {
  const [command, ...arguments_] = process.argv.slice(2);
  if (command === "check") {
    const scenarios = await loadDesignEvaluationScenarios();
    console.log(
      `Design evaluation scenarios are current: ${scenarios.map((item) => item.id).join(", ")}`,
    );
    return;
  }
  if (command === "prepare") {
    const outputRoot = takeOption(arguments_, "--output");
    const seed = takeOption(arguments_, "--seed");
    if (!outputRoot || !seed || arguments_.length < 2) {
      throw new Error(
        "Usage: design-evaluation prepare --output <dir> --seed <seed> <evidence-dir> <evidence-dir> [...]",
      );
    }
    const result = await prepareBlindReviewBundle({
      evidenceRoots: arguments_,
      outputRoot,
      seed,
    });
    console.log(
      `Prepared blind review ${result.packet.packetId}: ${resolve(outputRoot, "review")}`,
    );
    return;
  }
  if (command === "score") {
    const bundleRoot = takeOption(arguments_, "--bundle");
    const ratingsPath = takeOption(arguments_, "--ratings");
    if (!bundleRoot || !ratingsPath || arguments_.length > 0) {
      throw new Error(
        "Usage: design-evaluation score --bundle <dir> --ratings <ratings.json>",
      );
    }
    const result = await scoreBlindReviewBundle({ bundleRoot, ratingsPath });
    console.log(
      `Scored blind review ${result.packetId}: ${resolve(bundleRoot, "score.json")}`,
    );
    return;
  }
  throw new Error("Usage: design-evaluation <check|prepare|score>");
}

function takeOption(arguments_, name) {
  const index = arguments_.indexOf(name);
  if (index < 0) return null;
  const value = arguments_[index + 1];
  if (!value || value.startsWith("--")) return null;
  arguments_.splice(index, 2);
  return value;
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  await main();
}
