import { describe, expect, it } from "vitest";
import type { TrustedToolFailure } from "@opendesign/agent-contracts";
import { PiToolProgressCircuit } from "./pi-tool-progress-circuit.js";

const invalidInput: TrustedToolFailure = {
  code: "invalid_tool_input",
  message: "Invalid input",
  retryable: false,
  recoverable: true,
  details: {
    kind: "tool-validation",
    fingerprint: "validation_same",
    issues: [{ path: "/input/name", message: "Expected string" }],
    recovery: { action: "correct-and-retry", required: false },
  },
};

const recoverableFailure: TrustedToolFailure = {
  code: "design_invalid",
  message: "Revise the transaction",
  retryable: false,
  recoverable: true,
};

describe("PiToolProgressCircuit", () => {
  it("stops one repeated invalid-input fingerprint without a revision", () => {
    const circuit = new PiToolProgressCircuit();

    expect(
      circuit.recordFailure("opendesign_manage_design_system", invalidInput),
    ).not.toHaveProperty("runTerminal");
    expect(
      circuit.recordFailure("opendesign_manage_design_system", invalidInput),
    ).toMatchObject({
      code: "tool_protocol_no_progress",
      recoverable: false,
      runTerminal: true,
    });
  });

  it("does not combine different invalid inputs for one tool into a fake loop", () => {
    const circuit = new PiToolProgressCircuit();

    expect(
      circuit.recordFailure("opendesign_edit_design", invalidInput),
    ).not.toHaveProperty("runTerminal");
    expect(
      circuit.recordFailure("opendesign_edit_design", {
        ...invalidInput,
        details: {
          ...invalidInput.details!,
          fingerprint: "validation_corrected_but_different",
          issues: [{ path: "/input/size", message: "Expected number" }],
        },
      }),
    ).not.toHaveProperty("runTerminal");
  });

  it("does not combine unrelated recovery failures into a fake loop", () => {
    const circuit = new PiToolProgressCircuit();
    for (let index = 0; index < 4; index += 1) {
      expect(
        circuit.recordFailure(`tool_${index}`, {
          ...recoverableFailure,
          message: `design_workflow.issue_${index}: Revise transaction`,
        }),
      ).not.toHaveProperty("runTerminal");
    }
  });

  it("stops one repeated recoverable root cause without a revision", () => {
    const circuit = new PiToolProgressCircuit();
    circuit.recordFailure("opendesign_design_checkpoint", recoverableFailure);
    const result = circuit.recordFailure(
      "opendesign_design_checkpoint",
      recoverableFailure,
    );
    expect(result).toMatchObject({
      code: "design_recovery_no_progress",
      recoverable: false,
      runTerminal: true,
    });
  });

  it("does not count the required inspection guard as a repeated document failure", () => {
    const circuit = new PiToolProgressCircuit();
    const details: TrustedToolFailure["details"] = {
      kind: "design-transaction",
      fingerprint: "design_deadbeef",
      issues: [
        {
          path: "/nodesById/card/size",
          message: "width must be positive",
        },
      ],
      recovery: {
        action: "inspect-and-revise",
        toolName: "opendesign_inspect_document",
        required: true,
      },
    };

    expect(
      circuit.recordFailure("opendesign_apply_transaction", {
        ...recoverableFailure,
        details,
      }),
    ).not.toHaveProperty("runTerminal");
    expect(
      circuit.recordFailure("opendesign_apply_transaction", {
        ...recoverableFailure,
        code: "design_inspection_required",
        details,
      }),
    ).not.toHaveProperty("runTerminal");
    expect(
      circuit.recordFailure("opendesign_apply_transaction", {
        ...recoverableFailure,
        details,
      }),
    ).toMatchObject({
      code: "design_recovery_no_progress",
      runTerminal: true,
    });
  });

  it("resets the run circuit only when a trusted revision advances", () => {
    const circuit = new PiToolProgressCircuit();
    circuit.recordFailure("opendesign_manage_design_system", invalidInput);

    circuit.recordSuccess("opendesign_inspect_document", false);
    expect(
      circuit.recordFailure("opendesign_manage_design_system", invalidInput),
    ).toMatchObject({ runTerminal: true });

    circuit.recordSuccess("opendesign_apply_transaction", true);
    expect(
      circuit.recordFailure("opendesign_manage_design_system", invalidInput),
    ).not.toHaveProperty("runTerminal");
  });
});
