import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import {
  DesignNodeSchema,
  DesignTransactionContract,
  DesignTransactionResultContract,
  DesignOperationSchema,
  schemaValidationIssues,
  type DesignTransactionResult,
} from "./index.js";
import {
  actor,
  textDocumentFixture,
  operation,
} from "./index-test-fixtures.js";

describe("transaction design contracts", () => {
  it("owns transaction command identity and operation cross-field rules", () => {
    const command = operation();
    const duplicate = DesignTransactionContract.parse({
      transactionId: "transaction_duplicate_commands",
      documentId: "document_1",
      baseRevision: 0,
      actor,
      commands: [command, command],
    });
    expect(duplicate).toEqual({
      ok: false,
      issues: [
        expect.objectContaining({
          code: "design.transaction_command_id_duplicate",
          path: "/commands/1/commandId",
        }),
      ],
    });

    const emptyUpdate = DesignTransactionContract.parse({
      transactionId: "transaction_empty_update",
      documentId: "document_1",
      baseRevision: 0,
      actor,
      commands: [
        {
          commandId: "empty_update",
          type: "update_properties",
          nodeId: "node_1",
        },
      ],
    });
    expect(emptyUpdate).toEqual({
      ok: false,
      issues: [
        expect.objectContaining({
          code: "design.transaction_structure_invalid",
          path: "/commands/0",
        }),
      ],
    });
  });

  it("owns successful transaction result correlation", () => {
    const result = {
      ok: true as const,
      mode: "apply" as const,
      transactionId: "transaction_1",
      documentId: "document_1",
      baseRevision: 4,
      revision: {
        revision: 5,
        createdAt: "2026-08-26T12:00:00.000Z",
        transactionId: "transaction_1",
        actor,
      },
      changes: {
        documentId: "document_1",
        fromRevision: 4,
        toRevision: 5,
        addedNodeIds: ["node_1"],
        changedNodeIds: [] as string[],
        removedNodeIds: [],
        changes: [],
      },
      warnings: [],
    } satisfies DesignTransactionResult;
    expect(DesignTransactionResultContract.parse(result)).toEqual({
      ok: true,
      value: result,
    });

    const mismatched = structuredClone(result);
    mismatched.revision.revision = 6;
    mismatched.changes.changedNodeIds = ["node_1"];
    const parsed = DesignTransactionResultContract.parse(mismatched);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error("Expected result correlation to fail");
    expect(parsed.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "design.result_revision_invalid",
          path: "/revision/revision",
        }),
        expect.objectContaining({
          code: "design.result_change_identity_overlap",
          path: "/changes/changedNodeIds/0",
        }),
      ]),
    );
  });

  it("requires structured issues on transaction failures", () => {
    const failure = {
      ok: false as const,
      mode: "apply" as const,
      transactionId: "transaction_1",
      documentId: "document_1",
      baseRevision: 4,
      revision: {
        revision: 4,
        createdAt: "2026-08-26T12:00:00.000Z",
        actor,
      },
      error: {
        code: "invalid" as const,
        message: "Node is invalid",
        retryable: false,
        issues: [
          {
            code: "design.node.schema_invalid",
            commandId: "update_node",
            path: "/nodesById/node_1",
            message: "Node is invalid",
          },
        ],
      },
    };
    expect(DesignTransactionResultContract.parse(failure)).toEqual({
      ok: true,
      value: failure,
    });

    const legacyFailure = structuredClone(failure) as unknown as {
      error: Record<string, unknown>;
    };
    delete legacyFailure.error.issues;
    legacyFailure.error.commandId = "update_node";
    expect(DesignTransactionResultContract.issues(legacyFailure)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "design.result_structure_invalid",
          path: "/error/issues",
        }),
      ]),
    );
  });

  it("validates explicit constraints and nullable update removal", () => {
    const text = textDocumentFixture().nodesById.text_1;
    expect(
      Value.Check(DesignNodeSchema, {
        ...text,
        constraints: { horizontal: "left-right", vertical: "bottom" },
      }),
    ).toBe(true);
    expect(
      Value.Check(DesignNodeSchema, {
        ...text,
        constraints: { horizontal: "stretch", vertical: "bottom" },
      }),
    ).toBe(false);
    expect(
      Value.Check(DesignOperationSchema, {
        commandId: "clear_constraints",
        type: "update_properties",
        nodeId: "text_1",
        constraints: null,
      }),
    ).toBe(true);
  });

  it("validates strict absolute child positioning and nullable removal", () => {
    const text = textDocumentFixture().nodesById.text_1;
    expect(
      Value.Check(DesignNodeSchema, {
        ...text,
        layoutPositioning: "absolute",
      }),
    ).toBe(true);
    expect(
      Value.Check(DesignNodeSchema, {
        ...text,
        layoutPositioning: "flow",
      }),
    ).toBe(false);
    expect(
      Value.Check(DesignOperationSchema, {
        commandId: "clear_positioning",
        type: "update_properties",
        nodeId: text.id,
        layoutPositioning: null,
      }),
    ).toBe(true);
  });

  it("enforces canonical wrapping and overflow for Auto Size text", () => {
    const source = textDocumentFixture();
    const text = Object.values(source.nodesById).find(
      (node) => node.kind === "text",
    );
    if (!text || text.kind !== "text") throw new Error("Missing text");
    expect(
      Value.Check(DesignNodeSchema, {
        ...text,
        properties: {
          ...text.properties,
          textResize: "auto-width",
          textWrap: "none",
          textOverflow: "visible",
          textTruncation: "disabled",
          maxLines: null,
        },
      }),
    ).toBe(true);
    const invalidAutoWidth = {
      ...text,
      properties: {
        ...text.properties,
        textResize: "auto-width" as const,
        textWrap: "word" as const,
        textOverflow: "visible" as const,
      },
    };
    expect(Value.Check(DesignNodeSchema, invalidAutoWidth)).toBe(false);
    const issues = schemaValidationIssues(DesignNodeSchema, invalidAutoWidth);
    expect(issues.some((issue) => issue.path.startsWith("/properties"))).toBe(
      true,
    );
    expect(
      issues.some((issue) => issue.message === "Expected union value"),
    ).toBe(false);
    expect(
      Value.Check(DesignNodeSchema, {
        ...text,
        properties: {
          ...text.properties,
          textResize: "auto-height",
          textWrap: "word",
          textOverflow: "clip",
          textTruncation: "disabled",
          maxLines: null,
        },
      }),
    ).toBe(false);
    expect(
      Value.Check(DesignNodeSchema, {
        ...text,
        properties: {
          ...text.properties,
          textResize: "auto-height",
          textWrap: "word",
          textOverflow: "visible",
          textTruncation: "ending",
          maxLines: 3,
        },
      }),
    ).toBe(true);
    expect(
      Value.Check(DesignNodeSchema, {
        ...text,
        properties: {
          ...text.properties,
          textResize: "auto-height",
          textWrap: "word",
          textOverflow: "visible",
          textTruncation: "ending",
          maxLines: null,
        },
      }),
    ).toBe(false);
  });
});
