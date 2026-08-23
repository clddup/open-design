import assert from "node:assert/strict";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import {
  assertAcyclicGraph,
  packageExportAllowsSpecifier,
  packageRoot,
  processImportViolation,
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
