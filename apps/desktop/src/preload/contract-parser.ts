import {
  formatContractFailure,
  type Contract,
} from "@opendesign/contract-runtime";

export function parseContract<T, Context>(
  contract: Contract<T, Context>,
  value: unknown,
  subject: string,
  context?: Context,
): T {
  const result = contract.parse(value, context);
  if (!result.ok) {
    throw new TypeError(formatContractFailure(subject, result.issues));
  }
  return result.value;
}
