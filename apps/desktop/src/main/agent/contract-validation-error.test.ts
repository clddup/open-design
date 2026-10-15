import { expect, it } from "vitest";
import { isTrustedToolFailure } from "@opendesign/agent-contracts";
import { contractValidationError } from "./contract-validation-error";

function failure(
  actual: number,
  path = "/designGeneration/elements/0/strokeWidth",
) {
  const error = contractValidationError("opendesign_generate_design", [
    {
      code: "design_generation.group_stroke_width_unsupported",
      path,
      message: "Group strokeWidth must be zero",
      expected: 0,
      actual,
    },
  ]);
  if (!isTrustedToolFailure(error.cause))
    throw new Error("Invalid test failure");
  return error.cause;
}

it("keeps actual values in diagnostics, not in repeated-failure identity", () => {
  const first = failure(1);
  const second = failure(2);
  expect(first.details?.fingerprint).toBe(second.details?.fingerprint);
  expect(first.details?.issues[0]?.actual).toBe(1);
  expect(second.details?.issues[0]?.actual).toBe(2);
  expect(
    failure(1, "/designGeneration/elements/1/strokeWidth").details?.fingerprint,
  ).not.toBe(first.details?.fingerprint);
});
