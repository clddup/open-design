import { relative } from "node:path";

export function normalizeWorkspacePath(path) {
  return path.replaceAll("\\", "/");
}

export function relativeWorkspacePath(root, path) {
  return normalizeWorkspacePath(relative(root, path));
}
