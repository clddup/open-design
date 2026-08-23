import { access, readFile, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const platform = option("--platform", process.platform);
if (platform !== "darwin" && platform !== "win32") {
  throw new TypeError(`Unsupported package platform: ${platform}`);
}
if (platform !== process.platform) {
  throw new Error(
    `Native package verification requires ${platform}, but this runner is ${process.platform}`,
  );
}

const packageJson = JSON.parse(
  await readFile(resolve(root, "package.json"), "utf8"),
);
const version = packageJson.version;
const release = resolve(root, "release");
const releaseFiles = await recursiveFiles(release);
const nativeArch = process.arch;
const osName = platform === "darwin" ? "mac" : "win";
const expectedPrefix = `OpenDesign-${version}-${osName}-${nativeArch}`;

if (platform === "darwin") {
  requireReleaseFile(releaseFiles, `${expectedPrefix}.dmg`);
} else {
  requireReleaseFile(releaseFiles, `${expectedPrefix}.exe`);
}

const resources =
  platform === "darwin"
    ? await macResourcesDirectory(release)
    : resolve(release, "win-unpacked", "resources");
await requireFile(resolve(resources, "app.asar"));
await requireFile(resolve(resources, "icon.png"));
await requireFile(resolve(resources, "THIRD_PARTY_NOTICES.md"));
for (const processName of ["main", "agent"]) {
  const directory = resolve(root, "out", processName);
  const wrapper = await readFile(resolve(directory, "index.cjs"), "utf8");
  if (
    !wrapper.includes('require("./bytenode.cjs")') ||
    !wrapper.includes('require("./index.jsc")')
  ) {
    throw new Error(`${processName} protected entry is not a bytecode wrapper`);
  }
  await requireFile(resolve(directory, "index.jsc"));
  await requireFile(resolve(directory, "bytenode.cjs"));
}

const outputFiles = await recursiveFiles(resolve(root, "out"));
const sourceMaps = outputFiles.filter((path) => path.endsWith(".map"));
if (sourceMaps.length > 0) {
  throw new Error(
    `Protected output contains source maps: ${sourceMaps.join(", ")}`,
  );
}

process.stdout.write(
  `Native package verified: ${platform}/${nativeArch} · ${expectedPrefix}\n`,
);

async function macResourcesDirectory(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const unpacked = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("mac"))
    .map((entry) => entry.name)
    .sort();
  if (unpacked.length !== 1) {
    throw new Error(
      `Expected one macOS unpacked directory, found: ${unpacked.join(", ") || "none"}`,
    );
  }
  return resolve(
    directory,
    unpacked[0],
    "OpenDesign.app",
    "Contents",
    "Resources",
  );
}

function requireReleaseFile(files, basename) {
  if (!files.some((file) => file === basename)) {
    throw new Error(`Missing native release artifact: ${basename}`);
  }
}

async function requireFile(path) {
  await access(path);
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size < 1) {
    throw new Error(`Expected non-empty file: ${path}`);
  }
}

async function recursiveFiles(directory) {
  const entries = await readdir(directory, {
    recursive: true,
    withFileTypes: true,
  });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      resolve(entry.parentPath ?? entry.path, entry.name)
        .slice(resolve(directory).length + 1)
        .replaceAll("\\", "/"),
    )
    .sort();
}

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new TypeError(`${name} requires a value`);
  }
  return value;
}
