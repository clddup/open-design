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
