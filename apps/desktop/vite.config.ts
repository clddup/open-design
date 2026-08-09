import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import electron, {
  type MultiEnvElectronOptions,
} from "vite-plugin-electron/multi-env";
import { electronBytecode } from "./build/bytecode-plugin.ts";

const root = import.meta.dirname;
const startDesktop: NonNullable<MultiEnvElectronOptions["onstart"]> = async ({
  startup,
}) => {
  await startup([root], { cwd: root });
};

export default defineConfig(({ mode }) => {
  const protectedBuild = mode === "protected";
  return {
    root: resolve(root, "src/renderer"),
    plugins: [
      react(),
      electron([
        {
          name: "main",
          input: resolve(root, "src/main/index.ts"),
          onstart: startDesktop,
          bundleDeps: {
            both: { exclude: ["unpdf"], include: true },
          },
          options: {
            build: {
              outDir: resolve(root, "out/main"),
              emptyOutDir: true,
              sourcemap: !protectedBuild,
              rolldownOptions: {
                plugins: protectedBuild
                  ? [
                      electronBytecode({
                        entry: resolve(root, "out/main/index.cjs"),
                        processType: "main",
                      }),
                    ]
                  : [],
                output: {
                  entryFileNames: "index.cjs",
                  format: "cjs",
                },
              },
            },
          },
        },
        {
          name: "preload",
          input: resolve(root, "src/preload/index.ts"),
          onstart: startDesktop,
          bundleDeps: true,
          options: {
            build: {
              outDir: resolve(root, "out/preload"),
              emptyOutDir: true,
              sourcemap: !protectedBuild,
              rolldownOptions: {
                output: {
                  entryFileNames: "index.cjs",
                  format: "cjs",
                },
              },
            },
          },
        },
        {
          name: "agent",
          input: resolve(root, "src/agent/index.ts"),
          onstart: startDesktop,
          bundleDeps: true,
          options: {
            build: {
              outDir: resolve(root, "out/agent"),
              emptyOutDir: true,
              sourcemap: !protectedBuild,
              rolldownOptions: {
                external: ["electron"],
                plugins: protectedBuild
                  ? [
                      electronBytecode({
                        entry: resolve(root, "out/agent/index.cjs"),
                        processType: "utility",
                      }),
                    ]
                  : [],
                output: {
                  entryFileNames: "index.cjs",
                  format: "cjs",
                },
              },
            },
          },
        },
      ]),
    ],
    build: {
      outDir: resolve(root, "out/renderer"),
      emptyOutDir: true,
      sourcemap: !protectedBuild,
    },
  };
});
