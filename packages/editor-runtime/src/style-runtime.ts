import type {
  DesignDocument,
  DesignNode,
  DesignOperation,
  UpdatePropertiesCommand,
} from "@opendesign/design-contracts";
import { materializeNodeStyle, styleCanApply } from "@opendesign/style-service";
import { OperationError } from "./operation-error.js";

type StyleCommand = Extract<
  DesignOperation,
  {
    type: "put_style" | "delete_style" | "move_style" | "set_style_reference";
  }
>;

export function applyStyleOperation(
  document: DesignDocument,
  command: StyleCommand,
): void {
  switch (command.type) {
    case "put_style": {
      const current = document.stylesById[command.style.id];
      if (current && current.styleType !== command.style.styleType) {
        throw new OperationError(
          command.commandId,
          "A Style cannot change type after creation",
        );
      }
      const duplicateKey = Object.values(document.stylesById).find(
        (style) =>
          style.id !== command.style.id && style.key === command.style.key,
      );
      if (duplicateKey) {
        throw new OperationError(
          command.commandId,
          `Style key ${command.style.key} is already used by ${duplicateKey.id}`,
          "duplicate",
        );
      }
      document.stylesById[command.style.id] = structuredClone(command.style);
      if (!current) {
        document.styleOrderByType[command.style.styleType].push(
          command.style.id,
        );
      }
      return;
    }
    case "delete_style": {
      const style = document.stylesById[command.styleId];
      if (!style) throw notFound(command.commandId, command.styleId);
      const consumer = Object.values(document.nodesById).find((node) =>
        styleFields.some((field) => node[field] === command.styleId),
      );
      if (consumer) {
        throw new OperationError(
          command.commandId,
          `Style ${command.styleId} is still used by ${consumer.id}`,
        );
      }
      delete document.stylesById[command.styleId];
      const order = document.styleOrderByType[style.styleType];
      order.splice(order.indexOf(command.styleId), 1);
      return;
    }
    case "move_style": {
      const style = document.stylesById[command.styleId];
      if (!style) throw notFound(command.commandId, command.styleId);
      if (style.styleType !== command.styleType) {
        throw new OperationError(
          command.commandId,
          `Style ${command.styleId} is not ${command.styleType}`,
        );
      }
      const order = document.styleOrderByType[command.styleType];
      const from = order.indexOf(command.styleId);
      if (from < 0) throw notFound(command.commandId, command.styleId);
      if (command.index < 0 || command.index >= order.length) {
        throw new OperationError(
          command.commandId,
          "Style index is out of range",
        );
      }
      order.splice(from, 1);
      order.splice(command.index, 0, command.styleId);
      return;
    }
    case "set_style_reference": {
      const node = document.nodesById[command.target.nodeId];
      if (!node) throw notFound(command.commandId, command.target.nodeId);
      if (command.styleId) {
        const style = document.stylesById[command.styleId];
        if (!style) throw notFound(command.commandId, command.styleId);
        if (!styleCanApply(node, command.target.field, style)) {
          throw new OperationError(
            command.commandId,
            `${command.target.field} cannot consume ${style.styleType} style ${style.id}`,
          );
        }
        node[command.target.field] = command.styleId;
      } else {
        materializeReference(document, node, command.target.field);
        delete node[command.target.field];
      }
      return;
    }
  }
}

export function detachStyleReferencesForUpdate(
  document: DesignDocument,
  node: DesignNode,
  command: UpdatePropertiesCommand,
): void {
  const fields = new Set<(typeof styleFields)[number]>();
  if (command.effects !== undefined) fields.add("effectStyleId");
  const properties = command.properties;
  if (properties) {
    if ("fills" in properties) fields.add("fillStyleId");
    if ("strokes" in properties) fields.add("strokeStyleId");
    if ("layoutGuides" in properties) fields.add("gridStyleId");
    if (
      "fontFamily" in properties ||
      "fontSize" in properties ||
      "fontWeight" in properties ||
      "lineHeight" in properties ||
      "letterSpacing" in properties
    ) {
      fields.add("textStyleId");
    }
  }
  for (const field of fields) {
    if (!node[field]) continue;
    materializeReference(document, node, field);
    delete node[field];
  }
}

function materializeReference(
  document: DesignDocument,
  node: DesignNode,
  field: (typeof styleFields)[number],
): void {
  const resolved = materializeNodeStyle(document, node.id).node;
  if (!resolved) return;
  if (field === "effectStyleId") {
    if (resolved.effects) node.effects = structuredClone(resolved.effects);
    else delete node.effects;
  } else if (
    field === "textStyleId" &&
    node.kind === "text" &&
    resolved.kind === "text"
  ) {
    Object.assign(node.properties, {
      fontFamily: resolved.properties.fontFamily,
      fontSize: resolved.properties.fontSize,
      fontWeight: resolved.properties.fontWeight,
      lineHeight: resolved.properties.lineHeight,
      letterSpacing: resolved.properties.letterSpacing,
    });
  } else if (
    field === "gridStyleId" &&
    node.kind === "frame" &&
    resolved.kind === "frame"
  ) {
    if (resolved.properties.layoutGuides) {
      node.properties.layoutGuides = structuredClone(
        resolved.properties.layoutGuides,
      );
    } else delete node.properties.layoutGuides;
  } else if (hasPaints(node) && hasPaints(resolved)) {
    const property = field === "fillStyleId" ? "fills" : "strokes";
    node.properties[property] = structuredClone(resolved.properties[property]);
  }
}

const styleFields = [
  "fillStyleId",
  "strokeStyleId",
  "effectStyleId",
  "textStyleId",
  "gridStyleId",
] as const;

function hasPaints(node: DesignNode): node is DesignNode & {
  properties: { fills: unknown[]; strokes: unknown[] };
} {
  return "fills" in node.properties && "strokes" in node.properties;
}

function notFound(commandId: string, id: string): OperationError {
  return new OperationError(
    commandId,
    `Style or node ${id} does not exist`,
    "not-found",
  );
}
