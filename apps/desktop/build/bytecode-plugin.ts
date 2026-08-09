import bytenode from "bytenode";
import { createRequire } from "node:module";
import { copyFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { Plugin } from "vite";

const require = createRequire(import.meta.url);
const electronPath = require("electron") as string;
const bytenodePath = require.resolve("bytenode");

export function electronBytecode({
  entry,
  processType,
}: {
  entry: string;
  processType: "main" | "utility";
}): Plugin {
  return {
    name: `opendesign-bytecode-${processType}`,
    apply: "build",
    enforce: "post",
    async writeBundle() {
      const sourcePath = resolve(entry);
      const outputDirectory = dirname(sourcePath);
      const bytecodePath = sourcePath.replace(/\.(?:cjs|mjs|js)$/, ".jsc");
      const runtimePath = join(outputDirectory, "bytenode.cjs");
      await bytenode.compileFile({
        filename: sourcePath,
        output: bytecodePath,
        compileAsModule: true,
        electronMain: processType === "main",
        electron: processType === "utility",
        electronPath,
      });
      await copyFile(bytenodePath, runtimePath);
      await writeFile(
        sourcePath,
        'require("./bytenode.cjs");\nmodule.exports = require("./index.jsc");\n',
        "utf8",
      );
      await rm(`${sourcePath}.map`, { force: true });
    },
  };
}
