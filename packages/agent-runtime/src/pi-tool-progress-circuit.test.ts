import { describe, expect, it } from "vitest";
import type { TrustedToolFailure } from "./index.js";
import { PiToolProgressCircuit } from "./pi-tool-progress-circuit.js";

const invalidInput: TrustedToolFailure = {
  code: "invalid_tool_input",
  message: "Invalid input",
  retryable: false,
  recoverable: true,
};

const recoverableFailure: TrustedToolFailure = {
  code: "design_invalid",
  message: "Revise the transaction",
  retryable: false,
  recoverable: true,
};

describe("PiToolProgressCircuit", () => {
  it("stops two different invalid inputs for one tool without a revision", () => {
    const circuit = new PiToolProgressCircuit();

    expect(
      circuit.recordFailure("opendesign_manage_components", invalidInput),
    ).not.toHaveProperty("runTerminal");
    expect(
      circuit.recordFailure("opendesign_manage_components", invalidInput),
    ).toMatchObject({
      code: "tool_protocol_no_progress",
      recoverable: false,
      runTerminal: true,
    });
  });

  it("stops a cross-tool recovery loop after four failures without a revision", () => {
    const circuit = new PiToolProgressCircuit();
    let result = recoverableFailure;
    for (let index = 0; index < 4; index += 1) {
      result = circuit.recordFailure(`tool_${index}`, recoverableFailure);
    }
    expect(result).toMatchObject({
      code: "design_recovery_no_progress",
      recoverable: false,
      runTerminal: true,
    });
  });

  it("resets the run circuit only when a trusted revision advances", () => {
    const circuit = new PiToolProgressCircuit();
    circuit.recordFailure("opendesign_manage_components", invalidInput);

    circuit.recordSuccess("opendesign_inspect_document", false);
    expect(
      circuit.recordFailure("opendesign_manage_components", invalidInput),
    ).toMatchObject({ runTerminal: true });

    circuit.recordSuccess("opendesign_apply_transaction", true);
    expect(
      circuit.recordFailure("opendesign_manage_components", invalidInput),
    ).not.toHaveProperty("runTerminal");
  });
});
