import { describe, expect, it } from "vitest";
import {
  TrustedToolFailureContract,
  type TrustedToolFailure,
} from "@opendesign/agent-contracts";
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
    circuit.recordFailure("opendesign_edit_design", recoverableFailure);
    const result = circuit.recordFailure("opendesign_edit_design", {
      ...recoverableFailure,
      message: "Same failure with revised wording",
    });
    expect(result).toMatchObject({
      code: "design_recovery_no_progress",
      recoverable: false,
      runTerminal: true,
    });
  });

  it("does not attach stale workflow details to a circuit terminal failure", () => {
    const circuit = new PiToolProgressCircuit();
    const failure: TrustedToolFailure = {
      code: "design_visual_review_required",
      message: "Capture and review the current material revision",
      retryable: false,
      recoverable: true,
      details: {
        kind: "design-workflow",
        fingerprint: "workflow_visual_review",
        workflowCode: "visual_review_required",
        phase: "capture",
        requiresInspection: false,
        issues: [
          {
            code: "design_workflow.visual_review_required",
            path: "/designWorkflow",
            message: "Capture and review the current material revision",
          },
        ],
        recovery: { action: "follow-workflow", required: true },
      },
    };

    circuit.recordFailure("opendesign_capture_canvas", failure);
    const terminal = circuit.recordFailure(
      "opendesign_capture_canvas",
      failure,
    );

    expect(terminal).not.toHaveProperty("details");
    expect(TrustedToolFailureContract.parse(terminal)).toMatchObject({
      ok: true,
    });
  });

  it("allows one inspection-required recovery before stopping a true repeat", () => {
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
    const inspectionRequired = {
      ...recoverableFailure,
      code: "design_inspection_required",
      details,
    };
    expect(
      circuit.recordFailure("opendesign_edit_design", inspectionRequired),
    ).not.toHaveProperty("runTerminal");
    expect(
      circuit.recordFailure("opendesign_edit_design", inspectionRequired),
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
