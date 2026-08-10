import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtimeRoot = join(root, "packages/agent-runtime");
const requireFromRuntime = createRequire(join(runtimeRoot, "package.json"));
const runtimePackage = await json(join(runtimeRoot, "package.json"));
const desktopPackage = await json(join(root, "apps/desktop/package.json"));
const baseline = await json(join(root, "docs/engine-baseline.json"));
const corePackage = await json(
  requireFromRuntime.resolve("@earendil-works/pi-agent-core/package.json"),
);
const adapter = await readFile(
  join(runtimeRoot, "src/pi-core-adapter.ts"),
  "utf8",
);
const modelBridge = await readFile(
  join(runtimeRoot, "src/pi-model-gateway-adapter.ts"),
  "utf8",
);
const runEventAdapter = await readFile(
  join(runtimeRoot, "src/pi-run-event-adapter.ts"),
  "utf8",
);
const toolAdapter = await readFile(
  join(runtimeRoot, "src/pi-tool-adapter.ts"),
  "utf8",
);
const currentRuntime = await readFile(
  join(runtimeRoot, "src/index.ts"),
  "utf8",
);

const component = baseline.components.agentCore;
if (!component || component.role !== "headless-agent-loop-engine") {
  throw new Error("Agent core baseline is missing or has the wrong role");
}
assertEqual(
  runtimePackage.dependencies[component.dependency],
  component.version,
  "Agent Runtime dependency pin",
);
assertEqual(corePackage.version, component.version, "installed Agent core");
assertEqual(corePackage.license, component.license, "Agent core license");
assertEqual(
  runtimePackage.dependencies["@earendil-works/pi-ai"],
  component.version,
  "Agent Runtime Pi message dependency pin",
);

for (const manifest of [runtimePackage, desktopPackage]) {
  const dependencies = {
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.optionalDependencies,
  };
  rejectDependency(dependencies, "@earendil-works/pi-coding-agent");
  rejectDependency(dependencies, "@earendil-works/pi-tui");
}
rejectDependency(corePackage.dependencies, "@earendil-works/pi-coding-agent");
rejectDependency(corePackage.dependencies, "@earendil-works/pi-tui");

if (!/\bnew Agent\(/.test(adapter) || /\bAgentHarness\b/.test(adapter)) {
  throw new Error(
    "OpenDesign must use Pi's implemented headless Agent; AgentHarness is not usable at the pinned version",
  );
}
if (!/toolExecution:\s*"sequential"/.test(adapter)) {
  throw new Error("Pi adapter must force sequential tool execution");
}
if (!/OPENDESIGN_TOOL_PREFIX/.test(adapter)) {
  throw new Error(
    "Pi adapter must reject tools outside the OpenDesign namespace",
  );
}
if (
  !/\bModelGateway\b/.test(modelBridge) ||
  /\b(?:fetch|streamSimple|getApiKey)\s*\(/.test(modelBridge)
) {
  throw new Error(
    "Pi model bridge must use OpenDesign ModelGateway without direct provider or credential access",
  );
}
if (
  !/\bToolExecutorPort\b/.test(toolAdapter) ||
  !/\bApprovalPort\b/.test(toolAdapter) ||
  /\bUnsafe\s*[<(]/.test(toolAdapter)
) {
  throw new Error(
    "Pi tools must reuse OpenDesign host ports and unmodified standard JSON Schema",
  );
}
if (
  !/\bappendRunJournalEvent\b/.test(runEventAdapter) ||
  !/\bappendRunJournalEvent\b/.test(currentRuntime)
) {
  throw new Error(
    "Current and Pi Agent paths must share the OpenDesign run journal writer",
  );
}

process.stdout.write(
  `Agent core boundary is current: ${component.dependency} ${component.version}, headless Agent only\n`,
);

async function json(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} drift: ${String(actual)} != ${String(expected)}`);
  }
}

function rejectDependency(dependencies, name) {
  if (dependencies && Object.hasOwn(dependencies, name)) {
    throw new Error(`Forbidden Agent dependency: ${name}`);
  }
}
