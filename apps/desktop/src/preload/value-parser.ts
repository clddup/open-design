export type Guard<T> = (value: unknown) => value is T;

export function validate<T>(
  value: unknown,
  guard: Guard<T>,
  message: string,
): T {
  if (!guard(value)) throw new TypeError(message);
  return value;
}

export function validateArray<T>(
  value: unknown,
  guard: Guard<T>,
  message: string,
): T[] {
  if (!Array.isArray(value) || !value.every(guard)) {
    throw new TypeError(message);
  }
  return value;
}
