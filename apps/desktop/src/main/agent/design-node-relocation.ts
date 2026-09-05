import type { DesignOperation } from "@opendesign/design-contracts";

/** Relocation changes existing nodes only; it is not creation of a Plan target. */
export function isNodeRelocation(
  commands: readonly DesignOperation[],
): boolean {
  const movedIds = new Set(
    commands.flatMap((command) =>
      command.type === "move_element" ? [command.nodeId] : [],
    ),
  );
  return (
    movedIds.size > 0 &&
    commands.every(
      (command) =>
        command.type === "move_element" ||
        (command.type === "update_properties" && movedIds.has(command.nodeId)),
    )
  );
}
