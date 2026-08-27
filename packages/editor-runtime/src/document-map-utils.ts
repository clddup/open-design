export function hasOwn(record: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export function ownValue<T>(
  record: Record<string, T>,
  key: string,
): T | undefined {
  return hasOwn(record, key) ? record[key] : undefined;
}

export function jsonPointerToken(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}
