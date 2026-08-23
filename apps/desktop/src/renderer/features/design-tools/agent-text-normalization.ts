import type { DesignOperation } from "@opendesign/design-contracts";

export function normalizeAgentTextContent(
  commands: readonly DesignOperation[],
): DesignOperation[] {
  return commands.map((command) => {
    if (command.type === "insert_element" && command.node.kind === "text") {
      const content = decodeAgentTextLineBreaks(
        command.node.properties.content,
      );
      return content === command.node.properties.content
        ? command
        : {
            ...command,
            node: {
              ...command.node,
              properties: { ...command.node.properties, content },
            },
          };
    }
    if (
      command.type === "update_properties" &&
      command.properties &&
      typeof command.properties.content === "string"
    ) {
      const content = decodeAgentTextLineBreaks(command.properties.content);
      return content === command.properties.content
        ? command
        : {
            ...command,
            properties: { ...command.properties, content },
          };
    }
    if (command.type === "replace_subtree") {
      let changed = false;
      const nodes = command.nodes.map((node) => {
        if (node.kind !== "text") return node;
        const content = decodeAgentTextLineBreaks(node.properties.content);
        if (content === node.properties.content) return node;
        changed = true;
        return {
          ...node,
          properties: { ...node.properties, content },
        };
      });
      return changed ? { ...command, nodes } : command;
    }
    return command;
  });
}

export function decodeAgentTextLineBreaks(value: string): string {
  const protectedRanges = windowsPathRanges(value);
  let decoded = "";
  for (let index = 0; index < value.length;) {
    const protectedRange = protectedRanges.find(
      (range) => index >= range.start && index < range.end,
    );
    if (protectedRange) {
      decoded += value.slice(index, protectedRange.end);
      index = protectedRange.end;
      continue;
    }
    if (value[index] !== "\\") {
      decoded += value[index];
      index += 1;
      continue;
    }
    let slashEnd = index;
    while (value[slashEnd] === "\\") slashEnd += 1;
    if (slashEnd - index !== 1) {
      decoded += value.slice(index, slashEnd);
      index = slashEnd;
      continue;
    }
    if (value.startsWith("\\r\\n", index)) {
      decoded += "\n";
      index += 4;
      continue;
    }
    if (value[index + 1] === "n" || value[index + 1] === "r") {
      decoded += "\n";
      index += 2;
      continue;
    }
    decoded += "\\";
    index += 1;
  }
  return decoded;
}

function windowsPathRanges(
  value: string,
): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const pattern = /(?:[A-Za-z]:\\|\\\\[^\\\s]+\\)[^\s]*/g;
  for (const match of value.matchAll(pattern)) {
    const start = match.index;
    ranges.push({ start, end: start + match[0].length });
  }
  return ranges;
}
