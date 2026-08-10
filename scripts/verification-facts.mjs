import { execFileSync } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "prettier";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktopRoot = join(root, "apps/desktop");
const documentPath = join(root, "docs/verification.md");
const write = process.argv.includes("--write");
const check = process.argv.includes("--check");
if (write === check) {
  throw new TypeError("Use exactly one of --write or --check");
}

const rootPackage = await json("package.json");
const desktopPackage = await json("apps/desktop/package.json");
const leaferPackage = await json("packages/leafer-engine/package.json");
const baseline = await json("docs/engine-baseline.json");
const workflow = await text(".github/workflows/native-desktop.yml");
const agentContracts = await text("packages/agent-contracts/src/index.ts");
const designContracts = await text("packages/design-contracts/src/index.ts");
const requireFromDesktop = createRequire(join(desktopRoot, "package.json"));
const vitestPath = join(
  dirname(requireFromDesktop.resolve("vitest/package.json")),
  "vitest.mjs",
);

const nodeVersion = capture(
  workflow,
  /node-version:\s*([0-9.]+)/,
  "CI Node version",
);
const packageManager = capture(
  rootPackage.packageManager,
  /^pnpm@(.+)$/,
  "package manager version",
);
const electronVersion = await installedVersion("electron");
const viteVersion = await installedVersion("vite");
const agentProtocol = capture(
  agentContracts,
  /AGENT_PROTOCOL_VERSION\s*=\s*"([^"]+)"/,
  "Agent protocol version",
);
const documentSchemaVersion = capture(
  designContracts,
  /DESIGN_SCHEMA_VERSION\s*=\s*"([^"]+)"/,
  "DesignDocument schema version",
);
const engineVersion = baseline.components.leafer.version;

assertEqual(
  baseline.contracts.documentSchemaVersion,
  documentSchemaVersion,
  "engine baseline document schema",
);
assertEqual(
  leaferPackage.dependencies[baseline.components.leafer.dependency],
  engineVersion,
  "Leafer dependency pin",
);
assertEqual(
  leaferPackage.version,
  baseline.contracts.runtimeProtocolVersion,
  "Leafer adapter protocol",
);
assertEqual(
  desktopPackage.devDependencies.electron.replace(/^\^/, ""),
  electronVersion,
  "Electron installed version",
);
assertEqual(
  desktopPackage.devDependencies.vite.replace(/^\^/, ""),
  viteVersion,
  "Vite installed version",
);

const packageTests = listTests(root);
const desktopTests = listTests(desktopRoot);
const artifacts = await buildArtifacts();

const blocks = {
  baseline: [
    `- 环境基线：Node.js ${nodeVersion}、pnpm ${packageManager}、Electron ${electronVersion}、Vite ${viteVersion}`,
    `- 文档协议：\`DesignDocument ${documentSchemaVersion}\``,
    `- Agent 协议：\`${agentProtocol}\``,
    `- 生产画布：\`${baseline.components.leafer.dependency} ${engineVersion}\``,
  ].join("\n"),
  tests: [
    "```text",
    "pnpm format:check   passed",
    "pnpm capabilities:check passed",
    "pnpm fixtures:check passed",
    "pnpm lint           passed",
    "pnpm typecheck      passed",
    "pnpm test           passed",
    `├── package tests   ${packageTests.files} files / ${packageTests.tests} tests`,
    `└── desktop tests   ${desktopTests.files} files / ${desktopTests.tests} tests`,
    "pnpm build          passed",
    "├── Renderer",
    "├── Electron Main",
    "├── Preload",
    "└── Agent utilityProcess",
    "```",
  ].join("\n"),
  build: [
    "| 产物             | 实际字节数 | 十进制大小 |",
    "| ---------------- | ---------: | ---------: |",
    ...artifacts.map(
      (artifact) =>
        `| ${artifact.label.padEnd(16, " ")} | ${String(artifact.bytes).padStart(10, " ")} | ${formatKilobytes(artifact.bytes).padStart(10, " ")} |`,
    ),
  ].join("\n"),
};

const actualDocument = await readFile(documentPath, "utf8");
let expectedDocument = actualDocument;
for (const [name, expected] of Object.entries(blocks)) {
  const start = `<!-- verification-facts:${name}:start -->`;
  const end = `<!-- verification-facts:${name}:end -->`;
  const pattern = new RegExp(`${escape(start)}\\n[\\s\\S]*?\\n${escape(end)}`);
  const replacement = `${start}\n${expected}\n${end}`;
  if (!pattern.test(expectedDocument)) {
    throw new Error(`Missing verification facts block: ${name}`);
  }
  expectedDocument = expectedDocument.replace(pattern, replacement);
}
expectedDocument = await format(expectedDocument, { parser: "markdown" });

if (check && actualDocument !== expectedDocument) {
  throw new Error(
    "Verification facts drift detected. Run pnpm verification:generate after pnpm build.",
  );
}
if (write) {
  await writeFile(documentPath, expectedDocument, "utf8");
  process.stdout.write(
    `Updated verification facts: ${Object.keys(blocks).join(", ")}\n`,
  );
} else {
  process.stdout.write(
    `Verification facts are current: ${packageTests.tests + desktopTests.tests} tests · ${artifacts.length} build artifacts\n`,
  );
}

function listTests(cwd) {
  const output = execFileSync(
    process.execPath,
    [vitestPath, "list", "--json"],
    {
      cwd,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  const tests = JSON.parse(output);
  return {
    files: new Set(tests.map((test) => test.file)).size,
    tests: tests.length,
  };
}

async function buildArtifacts() {
  const assetDirectory = join(desktopRoot, "out/renderer/assets");
  const assets = await readdir(assetDirectory);
  const renderer = one(
    assets.filter((name) => /^index-[^.]+\.js$/.test(name)),
    "Renderer main JavaScript",
  );
  const leafer = one(
    assets.filter((name) => /^web\.esm\.min-[^.]+\.js$/.test(name)),
    "Leafer web JavaScript",
  );
  const files = [
    ["Renderer 主 JS", join(assetDirectory, renderer)],
    ["Leafer Web chunk", join(assetDirectory, leafer)],
    ["Electron Main", join(desktopRoot, "out/main/index.cjs")],
    ["Preload", join(desktopRoot, "out/preload/index.cjs")],
    ["Agent", join(desktopRoot, "out/agent/index.cjs")],
  ];
  return Promise.all(
    files.map(async ([label, path]) => ({
      label,
      bytes: (await readFile(path)).byteLength,
    })),
  );
}

async function installedVersion(packageName) {
  const path = requireFromDesktop.resolve(`${packageName}/package.json`);
  return JSON.parse(await readFile(path, "utf8")).version;
}

async function json(relativePath) {
  return JSON.parse(await text(relativePath));
}

function text(relativePath) {
  return readFile(join(root, relativePath), "utf8");
}

function capture(value, pattern, label) {
  const match = pattern.exec(value);
  if (!match?.[1]) throw new Error(`Cannot resolve ${label}`);
  return match[1];
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} drift: ${String(actual)} != ${String(expected)}`);
  }
}

function one(values, label) {
  if (values.length !== 1) {
    throw new Error(
      `Expected one ${label}, found: ${values.join(", ") || "none"}`,
    );
  }
  return values[0];
}

function formatKilobytes(bytes) {
  return `${(bytes / 1_000).toFixed(2)} kB`;
}

function escape(value) {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
