import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const FIXTURE_IDS = new Set(["OD-PENGUIN-01", "OD-POSTER-01", "OD-BRAND-01"]);
const fixtureId = process.argv.slice(2).find((value) => value !== "--");
if (!FIXTURE_IDS.has(fixtureId)) {
  throw new Error(
    "Expected fixture ID: OD-PENGUIN-01, OD-POSTER-01, or OD-BRAND-01",
  );
}
if (process.platform !== "darwin") {
  throw new Error("smoke:fixture:mac must run on macOS");
}

const appRoot = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(appRoot, "../..");
const evidenceRoot = resolve(
  repositoryRoot,
  "output/professional-smoke/darwin",
  fixtureId,
);
const outputRoot = await mkdtemp(
  resolve(tmpdir(), `opendesign-${fixtureId.toLowerCase()}-`),
);
const require = createRequire(import.meta.url);
const electronBinary = require("electron");
await rm(evidenceRoot, { recursive: true, force: true });

try {
  const exitCode = await runBoundedElectron(
    electronBinary,
    appRoot,
    outputRoot,
  );
  if (exitCode !== 0) {
    throw new Error(`Professional fixture smoke exited with code ${exitCode}`);
  }
  const report = JSON.parse(
    await readFile(resolve(outputRoot, "report.json"), "utf8"),
  );
  if (report.version !== 1 || report.fixtureId !== fixtureId || !report.ok) {
    throw new Error("Professional fixture smoke report is unsuccessful");
  }
  await verifyEvidence(outputRoot, report.captures.initial);
  await verifyEvidence(outputRoot, report.captures.refined);
  await verifyEvidence(outputRoot, report.captures.window);
  await verifyEvidence(outputRoot, report.finalDocument);
  if (report.revision !== 1) {
    throw new Error(`Expected final revision 1, received ${report.revision}`);
  }
  await mkdir(evidenceRoot, { recursive: true });
  await Promise.all(
    [
      "report.json",
      "initial.jpg",
      "refined.jpg",
      "window.png",
      "final.opendesign",
    ].map((file) => cp(resolve(outputRoot, file), resolve(evidenceRoot, file))),
  );
} finally {
  await rm(outputRoot, { recursive: true, force: true });
}
console.log(`Verified professional fixture smoke: ${fixtureId}`);
console.log(`Evidence: ${evidenceRoot}`);

function runBoundedElectron(binary, root, output) {
  return new Promise((resolveExit, reject) => {
    const child = spawn(binary, [root], {
      cwd: root,
      env: {
        ...process.env,
        OPENDESIGN_PROFESSIONAL_FIXTURE_SMOKE: fixtureId,
        OPENDESIGN_PROFESSIONAL_FIXTURE_OUTPUT: output,
      },
      stdio: "inherit",
    });
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Professional fixture smoke exceeded 100 seconds"));
    }, 100_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      if (signal) {
        reject(new Error(`Professional fixture smoke terminated by ${signal}`));
        return;
      }
      resolveExit(code ?? 1);
    });
  });
}

async function verifyEvidence(root, evidence) {
  if (
    !evidence ||
    typeof evidence.file !== "string" ||
    !/^[a-z-]+\.(jpg|png|opendesign)$/.test(evidence.file) ||
    !/^[a-f0-9]{64}$/.test(evidence.sha256)
  ) {
    throw new Error("Professional fixture smoke evidence metadata is invalid");
  }
  const bytes = await readFile(resolve(root, evidence.file));
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== evidence.sha256) {
    throw new Error(
      `Professional fixture smoke hash mismatch: ${evidence.file}`,
    );
  }
}
