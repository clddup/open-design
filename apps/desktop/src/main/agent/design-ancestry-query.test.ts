import { describe, expect, it } from "vitest";
import { createAncestryQuery } from "./design-ancestry-query";

class CountedParents extends Map<string, { parentId: string | null }> {
  reads = 0;
  override get(key: string) {
    this.reads += 1;
    return super.get(key);
  }
}

describe("frozen ancestry lookup", () => {
  it("matches uncached traversal for every query even with cycles, gaps and reversed query order", () => {
    const nodes = new Map<string, { parentId: string | null }>();
    for (let id = 0; id < 60; id += 1)
      nodes.set(`${id}`, {
        parentId: id % 7 === 0 ? null : `${(id * 13 + 3) % 67}`,
      });
    const absent = new Set(["12", "37"]);
    const reference = (id: string, root: string): boolean | undefined => {
      if (absent.has(root)) return false;
      const visited = new Set<string>();
      let current: string | null = id;
      while (current !== null) {
        if (absent.has(current)) return false;
        if (visited.has(current)) return undefined;
        visited.add(current);
        if (current === root) return true;
        const node = nodes.get(current);
        if (!node) return undefined;
        current = node.parentId;
      }
      return false;
    };
    const cached = createAncestryQuery(nodes, absent);
    for (const reverse of [false, true]) {
      const ids = Array.from({ length: 67 }, (_, index) => `${index}`);
      if (reverse) ids.reverse();
      for (const root of ids)
        for (const id of ids)
          expect(cached(id, root)).toBe(reference(id, root));
    }
  });

  it("walks each shared ancestor at most once per root rather than once per descendant", () => {
    const nodes = new CountedParents();
    const depth = 4_000;
    for (let index = 0; index < depth; index += 1)
      nodes.set(`${index}`, { parentId: index === 0 ? null : `${index - 1}` });
    const belongs = createAncestryQuery(nodes, new Set());
    for (let index = depth - 1; index >= 0; index -= 1)
      expect(belongs(`${index}`, "0")).toBe(true);
    // This asserts traversal complexity, not a product node quota or wall-clock threshold.
    expect(nodes.reads).toBeLessThanOrEqual(nodes.size);
  });
  it("keeps distinct roots and snapshots independent", () => {
    const before = new Map([
      ["a", { parentId: null }],
      ["b", { parentId: null }],
      ["child", { parentId: "a" }],
    ]);
    const belongs = createAncestryQuery(before, new Set());
    expect(belongs("child", "a")).toBe(true);
    expect(belongs("child", "b")).toBe(false);
    const after = new Map(before).set("child", { parentId: "b" });
    expect(createAncestryQuery(after, new Set())("child", "b")).toBe(true);
    expect(belongs("child", "a")).toBe(true);
  });
  it("retains unknown chains, cycles and explicit deletion semantics", () => {
    const nodes = new Map([
      ["a", { parentId: "b" }],
      ["b", { parentId: "a" }],
      ["c", { parentId: "missing" }],
      ["d", { parentId: "removed" }],
    ]);
    const belongs = createAncestryQuery(nodes, new Set(["removed"]));
    for (let repeat = 0; repeat < 2; repeat += 1) {
      expect(belongs("a", "other")).toBeUndefined();
      expect(belongs("c", "other")).toBeUndefined();
      expect(belongs("d", "other")).toBe(false);
      expect(belongs("removed", "removed")).toBe(false);
      expect(belongs("a", "b")).toBe(true);
    }
  });
});
