export function canonicalJsonStringify(value: unknown): string {
  const ancestors = new Set<object>();
  const stringify = (current: unknown): string => {
    if (current === null) return "null";
    if (typeof current === "string") return JSON.stringify(current);
    if (typeof current === "boolean") return current ? "true" : "false";
    if (typeof current === "number") {
      return Number.isFinite(current) ? String(current) : "null";
    }
    if (typeof current !== "object") {
      throw new TypeError("Value is not JSON serializable");
    }
    if (ancestors.has(current)) {
      throw new TypeError("Value contains a cyclic structure");
    }
    ancestors.add(current);
    try {
      if (Array.isArray(current)) {
        return `[${current.map((item) => stringify(item)).join(",")}]`;
      }
      const record = current as Record<string, unknown>;
      const entries = Object.keys(record)
        .sort()
        .filter((key) => record[key] !== undefined)
        .map((key) => `${JSON.stringify(key)}:${stringify(record[key])}`);
      return `{${entries.join(",")}}`;
    } finally {
      ancestors.delete(current);
    }
  };
  return stringify(value);
}
