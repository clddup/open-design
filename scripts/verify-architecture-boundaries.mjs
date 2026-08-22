import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertAcyclicGraph,
  packageExportAllowsSpecifier,
  packageRoot,
  processImportViolation,
  resolveSourceImport,
  sourceImports,
} from "./architecture-rules.mjs";
import { relativeWorkspacePath } from "./workspace-path.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const policy = await json("scripts/architecture-policy.json");
const manifests = await workspaceManifests();
const manifestByName = new Map(
  manifests.map((manifest) => [manifest.name, manifest]),
);

await verifyDesktopProcesses();
await verifyDesktopSourceGraph();
await verifyWorkspacePackages();

process.stdout.write(
  "Architecture source, package, and Electron process boundaries are current.\n",
);

async function verifyDesktopProcesses() {
  for (const [layerName, layerPolicy] of Object.entries(policy.desktopLayers)) {
    const files = await sourceFiles(resolve(root, layerPolicy.root));
    for (const file of files) {
      const imports = sourceImports(await readFile(file, "utf8"), file);
      for (const dependency of imports) {
        const { specifier } = dependency;
        if (specifier.startsWith(".")) {
          assertAllowedRelativeLayer(layerName, layerPolicy, file, specifier);
          continue;
        }
        const violation = processImportViolation(dependency, layerPolicy);
        if (violation) {
          fail(
            `${relativeWorkspacePath(root, file)} ${violation.replace("the process", `the ${layerName} process`)}`,
          );
        }
      }
    }
  }
}

async function verifyDesktopSourceGraph() {
  const sourceRoot = resolve(root, "apps/desktop/src");
  const files = await sourceFiles(sourceRoot);
  const fileSet = new Set(files);
  const graph = new Map(files.map((file) => [file, new Set()]));
  for (const file of files) {
    for (const { specifier, typeOnly } of sourceImports(
      await readFile(file, "utf8"),
      file,
    )) {
      if (typeOnly) continue;
      if (!specifier.startsWith(".")) continue;
      const target = resolveSourceImport(file, specifier, fileSet);
      if (target) {
        graph.get(file).add(target);
        continue;
      }
      if (!isAssetImport(specifier)) {
        fail(
          `${relativeWorkspacePath(root, file)} has unresolved source import ${specifier}`,
        );
      }
    }
  }
  try {
    assertAcyclicGraph(graph, "desktop source dependency");
  } catch (error) {
    fail(relativeCycleMessage(error));
  }
}

async function verifyWorkspacePackages() {
  const layerByPackage = classifiedWorkspacePackages();
  const packageNames = new Set(manifests.map((manifest) => manifest.name));
  for (const name of packageNames) {
    if (!layerByPackage.has(name)) {
      fail(`workspace package ${name} has no architecture layer`);
    }
  }
  for (const name of layerByPackage.keys()) {
    if (!packageNames.has(name)) {
      fail(`architecture policy classifies missing workspace package ${name}`);
    }
  }

  const graph = new Map();
  for (const manifest of manifests) {
    const dependencies = Object.keys(manifest.dependencies ?? {}).filter(
      (name) => manifestByName.has(name),
    );
    graph.set(manifest.name, new Set(dependencies));
    const sourceLayer = layerByPackage.get(manifest.name);
    const allowedLayers = new Set(
      policy.workspaceAllowedLayerDependencies[sourceLayer] ?? [],
    );
    for (const dependency of dependencies) {
      const targetLayer = layerByPackage.get(dependency);
      if (!allowedLayers.has(targetLayer)) {
        fail(
          `${manifest.name} (${sourceLayer}) cannot depend on ${dependency} (${targetLayer})`,
        );
      }
    }
    await verifyManifestImports(manifest);
  }
  try {
    assertAcyclicGraph(graph, "workspace dependency");
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

async function verifyManifestImports(manifest) {
  const directory = dirname(manifest.path);
  const sourceDirectory = resolve(directory, "src");
  if (!(await exists(sourceDirectory))) return;
  const files = await sourceFiles(sourceDirectory);
  const importedPackages = new Set();
  for (const file of files) {
    for (const { specifier } of sourceImports(
      await readFile(file, "utf8"),
      file,
    )) {
      if (specifier.startsWith(".")) continue;
      const dependency = packageRoot(specifier);
      if (
        dependency.startsWith("node:") ||
        dependency === "electron" ||
        policy.virtualModules.includes(dependency)
      ) {
        continue;
      }
      importedPackages.add(dependency);
      if (dependency === manifest.name) continue;
      const declarations = {
        ...(manifest.dependencies ?? {}),
        ...(manifest.optionalDependencies ?? {}),
        ...(manifest.peerDependencies ?? {}),
      };
      if (!(dependency in declarations)) {
        fail(
          `${relativeWorkspacePath(root, file)} imports undeclared production dependency ${dependency}`,
        );
      }
      const workspaceManifest = manifestByName.get(dependency);
      if (
        workspaceManifest &&
        !packageExportAllowsSpecifier(workspaceManifest, specifier)
      ) {
        fail(
          `${relativeWorkspacePath(root, file)} deep-imports non-exported workspace path ${specifier}`,
        );
      }
    }
  }

  const ignored = new Set(
    policy.ignoredUnusedDependencies[manifest.name] ?? [],
  );
  for (const dependency of Object.keys(manifest.dependencies ?? {})) {
    if (!importedPackages.has(dependency) && !ignored.has(dependency)) {
      fail(
        `${manifest.name} declares unused production dependency ${dependency}`,
      );
    }
  }
}

function assertAllowedRelativeLayer(layerName, layerPolicy, file, specifier) {
  const target = resolve(dirname(file), specifier);
  for (const forbiddenLayer of layerPolicy.forbiddenRelativeLayers ?? []) {
    const forbiddenRoot = resolve(root, "apps/desktop/src", forbiddenLayer);
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

function classifiedWorkspacePackages() {
  const result = new Map();
  for (const [layer, names] of Object.entries(policy.workspacePackageLayers)) {
    for (const name of names) {
      if (result.has(name)) fail(`workspace package ${name} has two layers`);
      result.set(name, layer);
    }
  }
  return result;
}

async function workspaceManifests() {
  const paths = [];
  for (const parent of ["packages", "apps"]) {
    const directory = resolve(root, parent);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        paths.push(join(directory, entry.name, "package.json"));
      }
    }
  }
  const result = [];
  for (const path of paths) {
    const manifest = JSON.parse(await readFile(path, "utf8"));
    if (
      typeof manifest.name === "string" &&
      manifest.name.startsWith("@opendesign/")
    ) {
      result.push({ ...manifest, path });
    }
  }
  return result;
}

async function sourceFiles(start) {
  const result = [];
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (isProductionSource(entry.name)) {
        result.push(path);
      }
    }
  };
  await visit(start);
  return result.sort();
}

function isProductionSource(name) {
  return (
    [".ts", ".tsx"].includes(extname(name)) &&
    !name.includes(".test.") &&
    !name.includes(".spec.") &&
    !name.endsWith(".d.ts") &&
    name !== "test-setup.ts"
  );
}

function isAssetImport(specifier) {
  return [".css", ".scss", ".png", ".svg", ".wasm"].includes(
    extname(specifier.split(/[?#]/u, 1)[0]),
  );
}

function relativeCycleMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll(root, ".");
}

async function exists(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function json(path) {
  return JSON.parse(await readFile(resolve(root, path), "utf8"));
}

function fail(message) {
  throw new Error(`Architecture boundary violation: ${message}`);
}
