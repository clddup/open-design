type ParentNodes = ReadonlyMap<string, { parentId: string | null }>;
type Membership = boolean | undefined;

/** Memoize only within one frozen view; undefined remains unknown, not false. */
export function createAncestryQuery(
  nodes: ParentNodes,
  absent: ReadonlySet<string>,
) {
  const byRoot = new Map<string, Map<string, Membership>>();
  return (nodeId: string, root: string): Membership => {
    if (absent.has(root)) return false;
    let memo = byRoot.get(root);
    if (!memo) {
      memo = new Map();
      byRoot.set(root, memo);
    }
    if (memo.has(nodeId)) return memo.get(nodeId);
    const path = new Set<string>();
    let current: string | null = nodeId;
    let result: Membership = false;
    while (current !== null) {
      if (absent.has(current)) break;
      if (memo.has(current)) {
        result = memo.get(current);
        break;
      }
      if (path.has(current)) {
        result = undefined;
        break;
      }
      path.add(current);
      if (current === root) {
        result = true;
        break;
      }
      const node = nodes.get(current);
      if (!node) {
        result = undefined;
        break;
      }
      current = node.parentId;
    }
    for (const id of path) memo.set(id, result);
    return result;
  };
}
