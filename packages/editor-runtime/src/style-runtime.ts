import type {
  DesignDocument,
  DesignNode,
  DesignOperation,
  UpdatePropertiesCommand,
} from "@opendesign/design-contracts";
import {
  materializeNodeStyle,
  styleCanApply,
  styleDefinition,
  styleDefinitions,
  styleIsReferenced,
} from "@opendesign/style-service";
import { OperationError } from "./operation-error.js";

type StyleCommand = Extract<
  DesignOperation,
  {
    type:
      | "put_style"
      | "delete_style"
      | "move_style"
      | "set_style_reference"
      | "put_library_style_source"
      | "delete_library_style_source";
  }
>;

export function applyStyleOperation(
  document: DesignDocument,
  command: StyleCommand,
): void {
  switch (command.type) {
    case "put_style": {
      if (document.libraryStylesById[command.style.id]) {
        throw new OperationError(
          command.commandId,
          "design.style.conflicts_library",
          `Style ${command.style.id} conflicts with a Library Style`,
          "duplicate",
        );
      }
      const current = document.stylesById[command.style.id];
      if (current && current.styleType !== command.style.styleType) {
        throw new OperationError(
          command.commandId,
          "design.style.type_immutable",
          "A Style cannot change type after creation",
        );
      }
      const duplicateKey = styleDefinitions(document).find(
        (style) =>
          style.id !== command.style.id && style.key === command.style.key,
      );
      if (duplicateKey) {
        throw new OperationError(
          command.commandId,
          "design.style.key_duplicate",
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
      const consumer = Object.values(document.nodesById).find(
        (node) =>
          styleFields.some((field) => node[field] === command.styleId) ||
          (node.kind === "text" &&
            (node.properties.runs ?? []).some(
              (run) =>
                run.style.textStyleId === command.styleId ||
                run.style.fillStyleId === command.styleId,
            )) ||
          ((node.kind === "path" || node.kind === "vector") &&
            "network" in node.properties &&
            node.properties.network.regions.some(
              (region) => region.fillStyleId === command.styleId,
            )),
      );
      if (consumer) {
        throw new OperationError(
          command.commandId,
          "design.style.in_use",
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
          "design.style.type_mismatch",
          `Style ${command.styleId} is not ${command.styleType}`,
        );
      }
      const order = document.styleOrderByType[command.styleType];
      const from = order.indexOf(command.styleId);
      if (from < 0) throw notFound(command.commandId, command.styleId);
      if (command.index < 0 || command.index >= order.length) {
        throw new OperationError(
          command.commandId,
          "design.style.index_out_of_range",
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
      if ("regionId" in command.target) {
        applyVectorRegionStyleReference(document, node, command);
        return;
      }
      if (command.styleId) {
        const style = styleDefinition(document, command.styleId);
        if (!style) throw notFound(command.commandId, command.styleId);
        if (!styleCanApply(node, command.target.field, style)) {
          throw new OperationError(
            command.commandId,
            "design.style.reference_incompatible",
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
    case "put_library_style_source": {
      const styleId = command.source.style.id;
      if (document.stylesById[styleId]) {
        throw new OperationError(
          command.commandId,
          "design.library_style.conflicts_local",
          `Library Style ${styleId} conflicts with a local Style`,
          "duplicate",
        );
      }
      const current = document.libraryStylesById[styleId];
      if (current && !sameLibraryStyleIdentity(current, command.source)) {
        throw new OperationError(
          command.commandId,
          "design.library_style.identity_changed",
          `Library Style ${styleId} cannot change source identity`,
          "invalid",
        );
      }
      if (
        current &&
        current.style.styleType !== command.source.style.styleType
      ) {
        throw new OperationError(
          command.commandId,
          "design.library_style.type_immutable",
          "A Library Style cannot change type after import",
          "invalid",
        );
      }
      const duplicateKey = styleDefinitions(document).find(
        (style) =>
          style.id !== styleId && style.key === command.source.style.key,
      );
      if (duplicateKey) {
        throw new OperationError(
          command.commandId,
          "design.style.key_duplicate",
          `Style key ${command.source.style.key} is already used by ${duplicateKey.id}`,
          "duplicate",
        );
      }
      document.libraryStylesById[styleId] = structuredClone(command.source);
      return;
    }
    case "delete_library_style_source": {
      if (!document.libraryStylesById[command.styleId]) {
        throw notFound(command.commandId, command.styleId);
      }
      if (styleIsReferenced(document, command.styleId)) {
        throw new OperationError(
          command.commandId,
          "design.library_style.in_use",
          `Library Style ${command.styleId} is still referenced`,
          "invalid",
        );
      }
      delete document.libraryStylesById[command.styleId];
      return;
    }
  }
}

function applyVectorRegionStyleReference(
  document: DesignDocument,
  node: DesignNode,
  command: Extract<StyleCommand, { type: "set_style_reference" }>,
): void {
  const target = command.target;
  if (
    !("regionId" in target) ||
    (node.kind !== "path" && node.kind !== "vector") ||
    !("network" in node.properties)
  ) {
    throw new OperationError(
      command.commandId,
      "design.style.reference_incompatible",
      "Vector region Fill Style requires an editable Vector Network",
    );
  }
  const region = node.properties.network.regions.find(
    (candidate) => candidate.id === target.regionId,
  );
  if (!region) throw notFound(command.commandId, target.regionId);
  if (command.styleId) {
    const style = styleDefinition(document, command.styleId);
    if (!style) throw notFound(command.commandId, command.styleId);
    if (style.styleType !== "PAINT") {
      throw new OperationError(
        command.commandId,
        "design.style.reference_incompatible",
        `Vector region fillStyleId cannot consume ${style.styleType} style ${style.id}`,
      );
    }
    region.fillStyleId = command.styleId;
    delete region.fills;
    return;
  }
  if (region.fillStyleId) {
    const style = styleDefinition(document, region.fillStyleId);
    if (style?.styleType === "PAINT") {
      region.fills = structuredClone(style.paints);
    }
  }
  delete region.fillStyleId;
}

function sameLibraryStyleIdentity(
  current: DesignDocument["libraryStylesById"][string],
  next: DesignDocument["libraryStylesById"][string],
): boolean {
  return (
    current.source.libraryId === next.source.libraryId &&
    current.source.sourceProjectId === next.source.sourceProjectId &&
    current.source.sourceDesignFileId === next.source.sourceDesignFileId &&
    current.source.sourceDocumentId === next.source.sourceDocumentId &&
    current.source.sourceStyleId === next.source.sourceStyleId
  );
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
      "fontStyleName" in properties ||
      "fontSize" in properties ||
      "fontWeight" in properties ||
      "fontSlant" in properties ||
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
      fontStyleName: resolved.properties.fontStyleName,
      fontSize: resolved.properties.fontSize,
      fontWeight: resolved.properties.fontWeight,
      fontSlant: resolved.properties.fontSlant,
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
    "design.style_or_node.not_found",
    `Style or node ${id} does not exist`,
    "not-found",
  );
}
