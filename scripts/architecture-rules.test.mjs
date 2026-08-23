import assert from "node:assert/strict";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import {
  assertAcyclicGraph,
  featureOwnershipViolation,
  isAliasedImport,
  packageExportAllowsSpecifier,
  packageRoot,
  pathIsWithin,
  processImportViolation,
  resolveAliasedImport,
  resolveSourceImport,
  sourceImports,
} from "./architecture-rules.mjs";

describe("architecture source rules", () => {
  it("distinguishes erased type imports from runtime dependencies", () => {
    assert.deepEqual(
      sourceImports(
        `
          import type { SessionStore } from "@opendesign/session-store";
          import { type AgentEvent, isAgentEvent } from "@opendesign/agent-contracts";
          export type { ToolRisk } from "@opendesign/tool-runtime";
          const module = await import("@opendesign/model-gateway");
        `,
      ),
      [
        { specifier: "@opendesign/session-store", typeOnly: true },
        { specifier: "@opendesign/agent-contracts", typeOnly: false },
        { specifier: "@opendesign/tool-runtime", typeOnly: true },
        { specifier: "@opendesign/model-gateway", typeOnly: false },
      ],
    );
  });

  it("resolves NodeNext .js source imports without a generated file", () => {
    const importer = resolve("workspace", "src", "agent", "index.ts");
    const target = resolve("workspace", "src", "shared", "bridge.ts");
    assert.equal(
      resolveSourceImport(importer, "../shared/bridge.js", new Set([target])),
      target,
    );
  });

  it("resolves configured source aliases without treating them as packages", () => {
    const importer = resolve("workspace", "src", "renderer", "index.ts");
    const sourceRoot = resolve("workspace", "src");
    const target = resolve(sourceRoot, "shared", "bridge.ts");
    assert.equal(
      resolveSourceImport(importer, "@/shared/bridge.js", new Set([target]), {
        "@": sourceRoot,
      }),
      target,
    );
    assert.equal(
      isAliasedImport("@/shared/bridge.js", { "@": sourceRoot }),
      true,
    );
    assert.equal(
      isAliasedImport("@opendesign/design-contracts", { "@": sourceRoot }),
      false,
    );
    assert.equal(
      resolveAliasedImport("@/../package.json", { "@": sourceRoot }),
      null,
    );
  });

  it("keeps aliased process boundaries and runtime cycles enforceable", () => {
    const sourceRoot = resolve("workspace", "src");
    const renderer = resolve(sourceRoot, "renderer", "feature.ts");
    const main = resolve(sourceRoot, "main", "host.ts");
    const aliases = { "@": sourceRoot };
    assert.equal(
      pathIsWithin(
        resolve(sourceRoot, "main"),
        resolveAliasedImport("@/main/host.js", aliases),
      ),
      true,
    );

    const graph = new Map([
      [
        renderer,
        new Set([
          resolveSourceImport(
            renderer,
            "@/main/host.js",
            new Set([main]),
            aliases,
          ),
        ]),
      ],
      [
        main,
        new Set([
          resolveSourceImport(
            main,
            "@/renderer/feature.js",
            new Set([renderer]),
            aliases,
          ),
        ]),
      ],
    ]);
    assert.throws(
      () => assertAcyclicGraph(graph, "desktop source dependency"),
      /desktop source dependency cycle/u,
    );
  });

  it("enforces governed feature ownership through public entries", () => {
    const policy = {
      compositionFeature: "editor-workbench",
      governedFeatures: ["canvas", "editor", "workbench"],
    };
    assert.match(
      featureOwnershipViolation({
        ...policy,
        sourceFeature: "canvas",
        targetFeature: "editor-workbench",
        targetPath: "components/Canvas.tsx",
      }),
      /cannot depend/u,
    );
    assert.match(
      featureOwnershipViolation({
        ...policy,
        sourceFeature: "editor-workbench",
        targetFeature: "canvas",
        targetPath: "components/Canvas.tsx",
      }),
      /public entry/u,
    );
    assert.equal(
      featureOwnershipViolation({
        ...policy,
        sourceFeature: "editor-workbench",
        targetFeature: "canvas",
        targetPath: "index.ts",
      }),
      null,
    );
  });

  it("reports a concrete source cycle", () => {
    assert.throws(
      () =>
        assertAcyclicGraph(
          new Map([
            ["a.ts", new Set(["b.ts"])],
            ["b.ts", new Set(["a.ts"])],
          ]),
        ),
      /a\.ts → b\.ts → a\.ts/u,
    );
  });

  it("accepts only public workspace export subpaths", () => {
    const manifest = {
      name: "@opendesign/geometry-service",
      exports: {
        ".": "./src/index.ts",
        "./vector-path": "./src/vector-path.ts",
      },
    };
    assert.equal(
      packageExportAllowsSpecifier(
        manifest,
        "@opendesign/geometry-service/vector-path",
      ),
      true,
    );
    assert.equal(
      packageExportAllowsSpecifier(
        manifest,
        "@opendesign/geometry-service/src/vector-path",
      ),
      false,
    );
    assert.equal(packageRoot("@scope/package/subpath"), "@scope/package");
  });

  it("enforces runtime package capability without rejecting erased types", () => {
    const agentPolicy = {
      allowedBuiltins: [],
      allowedPackages: ["@opendesign/agent-contracts"],
    };
    assert.equal(
      processImportViolation(
        { specifier: "node:path", typeOnly: false },
        agentPolicy,
      ),
      "imports unapproved node:path",
    );
    assert.equal(
      processImportViolation(
        { specifier: "@opendesign/session-store", typeOnly: true },
        agentPolicy,
      ),
      null,
    );
    assert.equal(
      processImportViolation(
        { specifier: "@opendesign/tool-runtime", typeOnly: false },
        agentPolicy,
      ),
      "imports package @opendesign/tool-runtime outside the process allowlist",
    );
  });
});
