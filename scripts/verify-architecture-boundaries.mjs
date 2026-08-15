import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { relativeWorkspacePath } from "./workspace-path.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baseline = await json("scripts/architecture-baseline.json");

await verifyDesktopLayers();
await verifyWorkspaceDependencies();

process.stdout.write(
  "Architecture dependency and process boundaries are current.\n",
);

async function verifyDesktopLayers() {
  for (const [layerName, policy] of Object.entries(baseline.desktopLayers)) {
    const files = await sourceFiles(policy.root);
    for (const file of files) {
      const source = await readFile(file, "utf8");
      for (const specifier of importSpecifiers(source)) {
        if (
          policy.forbiddenBuiltins?.some((prefix) =>
            prefix.endsWith(":")
              ? specifier.startsWith(prefix)
              : specifier === prefix,
          )
        ) {
          fail(
            `${relativeWorkspacePath(root, file)} imports forbidden ${specifier}`,
          );
        }
        if (
          policy.allowedBuiltins &&
          (specifier === "electron" || specifier.startsWith("node:")) &&
          !policy.allowedBuiltins.some((prefix) =>
            prefix.endsWith(":")
              ? specifier.startsWith(prefix)
              : specifier === prefix,
          )
        ) {
          fail(
            `${relativeWorkspacePath(root, file)} imports unapproved ${specifier}`,
          );
        }
        if (!specifier.startsWith(".")) continue;
        const target = resolve(dirname(file), specifier);
        for (const forbiddenLayer of policy.forbiddenRelativeLayers ?? []) {
          const forbiddenRoot = resolve(
            root,
            "apps/desktop/src",
            forbiddenLayer,
          );
          if (
            target === forbiddenRoot ||
            target.startsWith(`${forbiddenRoot}${sep}`)
          ) {
            fail(
              `${relativeWorkspacePath(root, file)} crosses ${layerName} → ${forbiddenLayer}`,
            );
          }
        }
      }
    }
  }
}

async function verifyWorkspaceDependencies() {
  const packages = await packageManifests();
  const actual = {};
  for (const manifestPath of packages) {
    const manifest = await json(relativeWorkspacePath(root, manifestPath));
    if (
      typeof manifest.name !== "string" ||
      !manifest.name.startsWith("@opendesign/")
    )
      continue;
    actual[manifest.name] = Object.keys(manifest.dependencies ?? {})
      .filter((name) => name.startsWith("@opendesign/"))
      .sort();
  }
  const expectedNames = Object.keys(baseline.workspaceDependencies).sort();
  if (
    JSON.stringify(Object.keys(actual).sort()) !== JSON.stringify(expectedNames)
  ) {
    fail(
      "workspace package set drifted; update the architecture ADR and baseline",
    );
  }
  for (const name of expectedNames) {
    const expected = [...baseline.workspaceDependencies[name]].sort();
    if (JSON.stringify(actual[name]) !== JSON.stringify(expected)) {
      fail(
        `${name} dependency boundary drift: ${JSON.stringify(actual[name])} != ${JSON.stringify(expected)}`,
      );
    }
  }
  assertAcyclic(actual);
}

function assertAcyclic(graph) {
  const visited = new Set();
  const active = new Set();
  const visit = (name, path) => {
    if (active.has(name))
      fail(`workspace dependency cycle: ${[...path, name].join(" → ")}`);
    if (visited.has(name)) return;
    active.add(name);
    for (const dependency of graph[name] ?? [])
      visit(dependency, [...path, name]);
    active.delete(name);
    visited.add(name);
  };
  for (const name of Object.keys(graph)) visit(name, []);
}

function importSpecifiers(source) {
  const values = [];
  const pattern =
    /(?:\bfrom\s*|\bimport\s*(?:\(|(?=["']))|\brequire\s*\()\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(pattern)) values.push(match[1]);
  return values;
}

async function sourceFiles(relativeRoot) {
  const start = resolve(root, relativeRoot);
  const result = [];
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (
        [".ts", ".tsx"].includes(extname(entry.name)) &&
        !entry.name.includes(".test.") &&
        !entry.name.endsWith(".d.ts")
      ) {
        result.push(path);
      }
    }
  };
  await visit(start);
  return result;
}

async function packageManifests() {
  const directory = resolve(root, "packages");
  return (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(directory, entry.name, "package.json"));
}

async function json(path) {
  return JSON.parse(await readFile(resolve(root, path), "utf8"));
}

function fail(message) {
  throw new Error(`Architecture boundary violation: ${message}`);
}
