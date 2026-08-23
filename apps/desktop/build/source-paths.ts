import { resolve } from "node:path";
import sourceAliases from "../source-aliases.json" with { type: "json" };

const desktopRoot = resolve(import.meta.dirname, "..");

/** Shared by Vite and Vitest so production and tests resolve source owners alike. */
export const desktopSourceAliases = Object.fromEntries(
  Object.entries(sourceAliases).map(([alias, path]) => [
    alias,
    resolve(desktopRoot, path),
  ]),
);
