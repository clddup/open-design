import type {
  DesignDocument,
  DesignOperation,
} from "@opendesign/design-contracts";
import type { ComponentOperationPlan } from "./component-operations.js";

export function planReorderComponentProperties(
  document: DesignDocument,
  input: {
    componentId: string;
    componentPropertyOrder: readonly string[];
    commandPrefix: string;
  },
): ComponentOperationPlan {
  const component = document.componentsById[input.componentId];
  if (!component) {
    return {
      ok: false,
      code: "missing-component",
      message: `Component ${input.componentId} does not exist`,
    };
  }
  const expected = component.componentPropertyOrder;
  const proposed = new Set(input.componentPropertyOrder);
  if (
    input.componentPropertyOrder.length !== expected.length ||
    proposed.size !== expected.length ||
    expected.some((name) => !proposed.has(name))
  ) {
    return {
      ok: false,
      code: "invalid",
      message:
        "Component property order must contain every ordinary property exactly once",
    };
  }
  if (
    expected.every(
      (name, index) => name === input.componentPropertyOrder[index],
    )
  ) {
    return {
      ok: false,
      code: "no-op",
      message: "Component property order is unchanged",
    };
  }
  const next = {
    ...structuredClone(component),
    componentPropertyOrder: [...input.componentPropertyOrder],
  };
  const commands: DesignOperation[] = [
    {
      commandId: `${input.commandPrefix}_put_component`,
      type: "put_component",
      component: next,
    },
  ];
  return {
    ok: true,
    commands,
    componentId: component.id,
    mainNodeId: component.rootNodeId,
    selectionNodeIds: [component.rootNodeId],
  };
}
