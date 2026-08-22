import type {
  DesignDocument,
  DesignOperation,
  LibraryReleaseSnapshot,
  SharedStyleDefinition,
  SharedStyleType,
  StyleReferenceTarget,
} from "@opendesign/design-contracts";
import {
  materializeNodeStyle,
  styleCanApply,
  styleConsumers,
  styleDefinition,
  styleDefinitions,
  styleTypeForReference,
  validateStyleDocument,
} from "@opendesign/style-service";
import { libraryReleaseAssets } from "@opendesign/library-service";

export type StyleOperationFailureCode = "duplicate" | "invalid" | "not-found";

export type StyleOperationPlan =
  | { ok: true; commands: DesignOperation[] }
  | { ok: false; code: StyleOperationFailureCode; message: string };

export function planCreateStyle(
  document: DesignDocument,
  input: {
    style: SharedStyleDefinition;
    index?: number;
    commandPrefix: string;
  },
): StyleOperationPlan {
  if (styleDefinition(document, input.style.id)) {
    return failure("duplicate", `Style ${input.style.id} already exists`);
  }
  if (
    styleDefinitions(document).some((style) => style.key === input.style.key)
  ) {
    return failure("duplicate", `Style key ${input.style.key} already exists`);
  }
  const commands: DesignOperation[] = [
    {
      commandId: `${input.commandPrefix}_put_style`,
      type: "put_style",
      style: structuredClone(input.style),
    },
  ];
  const order = document.styleOrderByType[input.style.styleType];
  if (input.index !== undefined) {
    if (input.index < 0 || input.index > order.length) {
      return failure("invalid", "Style index is out of range");
    }
    if (input.index !== order.length) {
      commands.push({
        commandId: `${input.commandPrefix}_move_style`,
        type: "move_style",
        styleId: input.style.id,
        styleType: input.style.styleType,
        index: input.index,
      });
    }
  }
  return { ok: true, commands };
}

export function planUpdateStyle(
  document: DesignDocument,
  input: { style: SharedStyleDefinition; commandPrefix: string },
): StyleOperationPlan {
  const current = document.stylesById[input.style.id];
  if (!current)
    return failure("not-found", `Style ${input.style.id} does not exist`);
  if (current.styleType !== input.style.styleType) {
    return failure("invalid", "A Style cannot change type after creation");
  }
  const projected = structuredClone(document);
  projected.stylesById[input.style.id] = structuredClone(input.style);
  const issue = validateStyleDocument(projected)[0];
  if (issue) return failure("invalid", issue.message);
  return {
    ok: true,
    commands: [
      {
        commandId: `${input.commandPrefix}_put_style`,
        type: "put_style",
        style: structuredClone(input.style),
      },
    ],
  };
}

export function planMoveStyle(
  document: DesignDocument,
  input: {
    styleId: string;
    index: number;
    commandPrefix: string;
  },
): StyleOperationPlan {
  const style = document.stylesById[input.styleId];
  if (!style)
    return failure("not-found", `Style ${input.styleId} does not exist`);
  const order = document.styleOrderByType[style.styleType];
  const from = order.indexOf(input.styleId);
  if (input.index < 0 || input.index >= order.length) {
    return failure("invalid", "Style index is out of range");
  }
  if (from === input.index)
    return failure("invalid", "Style order is unchanged");
  return {
    ok: true,
    commands: [
      {
        commandId: `${input.commandPrefix}_move_style`,
        type: "move_style",
        styleId: input.styleId,
        styleType: style.styleType,
        index: input.index,
      },
    ],
  };
}

export function planSetStyleReference(
  document: DesignDocument,
  input: {
    target: StyleReferenceTarget;
    styleId: string | null;
    commandPrefix: string;
  },
): StyleOperationPlan {
  const node = document.nodesById[input.target.nodeId];
  if (!node)
    return failure("not-found", `Node ${input.target.nodeId} does not exist`);
  if (input.styleId) {
    const style = styleDefinition(document, input.styleId);
    if (!style)
      return failure("not-found", `Style ${input.styleId} does not exist`);
    if (!styleCanApply(node, input.target.field, style)) {
      return failure(
        "invalid",
        `${input.target.field} requires a compatible ${styleTypeForReference(input.target.field)} style`,
      );
    }
  } else if (!node[input.target.field]) {
    return failure("invalid", `${input.target.field} is already detached`);
  }
  if (node[input.target.field] === input.styleId) {
    return failure("invalid", `${input.target.field} is unchanged`);
  }
  return {
    ok: true,
    commands: [
      {
        commandId: `${input.commandPrefix}_set_style`,
        type: "set_style_reference",
        target: structuredClone(input.target),
        styleId: input.styleId,
      },
    ],
  };
}

export function planApplyLibraryStyle(
  document: DesignDocument,
  release: LibraryReleaseSnapshot,
  input: {
    styleId: string;
    target: StyleReferenceTarget;
    commandPrefix: string;
  },
): StyleOperationPlan {
  const source = release.stylesById[input.styleId];
  if (!source) {
    return failure(
      "not-found",
      `Style ${input.styleId} is not part of Library ${release.libraryId}`,
    );
  }
  if (document.stylesById[input.styleId]) {
    return failure(
      "duplicate",
      `Library Style ${input.styleId} conflicts with a local Style`,
    );
  }
  const imported = document.libraryStylesById[input.styleId];
  if (imported && !sameLibraryIdentity(imported.source, source.source)) {
    return failure(
      "duplicate",
      `Style ${input.styleId} conflicts with another Library source`,
    );
  }
  const staged: DesignDocument = {
    ...document,
    libraryStylesById: {
      ...document.libraryStylesById,
      [input.styleId]: structuredClone(source),
    },
  };
  const reference = planSetStyleReference(staged, {
    target: input.target,
    styleId: input.styleId,
    commandPrefix: input.commandPrefix,
  });
  if (!reference.ok) return reference;
  const commands: DesignOperation[] = [];
  if (source.style.styleType === "PAINT") {
    const releaseAssets = libraryReleaseAssets(release);
    for (const assetId of new Set(
      source.style.paints.flatMap((paint) =>
        paint.type === "image" ? [paint.assetId] : [],
      ),
    )) {
      const asset = releaseAssets[assetId];
      if (!asset) {
        return failure(
          "invalid",
          `Library Image Paint Style ${input.styleId} is missing asset ${assetId}`,
        );
      }
      const existing = document.assetsById[assetId];
      if (existing && JSON.stringify(existing) !== JSON.stringify(asset)) {
        return failure(
          "duplicate",
          `Library image asset ${assetId} conflicts with the current Design File`,
        );
      }
      if (!existing) {
        commands.push({
          commandId: `${input.commandPrefix}_put_asset_${commands.length}`,
          type: "put_asset",
          asset: structuredClone(asset),
        });
      }
    }
  }
  if (!imported || JSON.stringify(imported) !== JSON.stringify(source)) {
    commands.push({
      commandId: `${input.commandPrefix}_put_library_style`,
      type: "put_library_style_source",
      source: structuredClone(source),
    });
  }
  commands.push(...reference.commands);
  return { ok: true, commands };
}

export function planDeleteStyle(
  document: DesignDocument,
  input: { styleId: string; commandPrefix: string },
): StyleOperationPlan {
  if (!document.stylesById[input.styleId]) {
    return failure("not-found", `Style ${input.styleId} does not exist`);
  }
  const commands: DesignOperation[] = styleConsumers(
    document,
    input.styleId,
  ).map((target, index) => ({
    commandId: `${input.commandPrefix}_detach_${index + 1}`,
    type: "set_style_reference",
    target,
    styleId: null,
  }));
  commands.push({
    commandId: `${input.commandPrefix}_delete_style`,
    type: "delete_style",
    styleId: input.styleId,
  });
  return { ok: true, commands };
}

export function planCreateStyleFromNode(
  document: DesignDocument,
  input: {
    nodeId: string;
    field: StyleReferenceTarget["field"];
    styleId: string;
    key: string;
    name: string;
    description?: string;
    commandPrefix: string;
  },
): StyleOperationPlan {
  const resolved = materializeNodeStyle(document, input.nodeId).node;
  if (!resolved)
    return failure("not-found", `Node ${input.nodeId} does not exist`);
  const base = {
    id: input.styleId,
    key: input.key,
    name: input.name,
    description: input.description ?? "",
    hiddenFromPublishing: false,
    extensions: {},
  };
  let style: SharedStyleDefinition;
  const styleType: SharedStyleType = styleTypeForReference(input.field);
  if (styleType === "EFFECT") {
    style = {
      ...base,
      styleType,
      effects: structuredClone(resolved.effects ?? []),
    };
  } else if (styleType === "TEXT" && resolved.kind === "text") {
    style = {
      ...base,
      styleType,
      textStyle: {
        fontFamily: resolved.properties.fontFamily,
        fontStyleName: resolved.properties.fontStyleName,
        fontSize: resolved.properties.fontSize,
        fontWeight: resolved.properties.fontWeight,
        fontSlant: resolved.properties.fontSlant,
        lineHeight: resolved.properties.lineHeight,
        letterSpacing: resolved.properties.letterSpacing,
        paragraphIndent: resolved.properties.paragraphIndent,
        paragraphSpacing: resolved.properties.paragraphSpacing,
        listSpacing: resolved.properties.listSpacing,
        hangingList: resolved.properties.hangingList,
        textCase: resolved.properties.textCase,
        textDecoration: resolved.properties.textDecoration,
      },
    };
  } else if (styleType === "GRID" && resolved.kind === "frame") {
    style = {
      ...base,
      styleType,
      layoutGuides: structuredClone(resolved.properties.layoutGuides ?? []),
    };
  } else if (styleType === "PAINT" && hasPaints(resolved)) {
    style = {
      ...base,
      styleType,
      paints: structuredClone(
        resolved.properties[
          input.field === "fillStyleId" ? "fills" : "strokes"
        ],
      ),
    };
  } else {
    return failure(
      "invalid",
      `${input.field} is not supported by ${resolved.kind}`,
    );
  }
  const created = planCreateStyle(document, {
    style,
    commandPrefix: input.commandPrefix,
  });
  if (!created.ok) return created;
  return {
    ok: true,
    commands: [
      ...created.commands,
      {
        commandId: `${input.commandPrefix}_bind_style`,
        type: "set_style_reference",
        target: { nodeId: input.nodeId, field: input.field },
        styleId: input.styleId,
      },
    ],
  };
}

export function planUpdateStyleFromNode(
  document: DesignDocument,
  input: {
    styleId: string;
    nodeId: string;
    field: StyleReferenceTarget["field"];
    commandPrefix: string;
  },
): StyleOperationPlan {
  const current = document.stylesById[input.styleId];
  if (!current)
    return failure("not-found", `Style ${input.styleId} does not exist`);
  if (current.styleType !== styleTypeForReference(input.field)) {
    return failure(
      "invalid",
      `${input.field} cannot update ${current.styleType} style`,
    );
  }
  const withoutCurrent = structuredClone(document);
  delete withoutCurrent.stylesById[current.id];
  withoutCurrent.styleOrderByType[current.styleType] =
    withoutCurrent.styleOrderByType[current.styleType].filter(
      (styleId) => styleId !== current.id,
    );
  const extracted = planCreateStyleFromNode(withoutCurrent, {
    nodeId: input.nodeId,
    field: input.field,
    styleId: current.id,
    key: current.key,
    name: current.name,
    description: current.description,
    commandPrefix: input.commandPrefix,
  });
  if (!extracted.ok) return extracted;
  const put = extracted.commands.find(
    (command): command is Extract<DesignOperation, { type: "put_style" }> =>
      command.type === "put_style",
  );
  if (!put)
    return failure("invalid", "Could not extract Style payload from node");
  return planUpdateStyle(document, {
    style: {
      ...put.style,
      hiddenFromPublishing: current.hiddenFromPublishing,
      extensions: structuredClone(current.extensions),
    },
    commandPrefix: input.commandPrefix,
  });
}

function hasPaints(node: DesignDocument["nodesById"][string]): node is Extract<
  DesignDocument["nodesById"][string],
  {
    kind:
      | "frame"
      | "slot"
      | "boolean"
      | "rectangle"
      | "ellipse"
      | "line"
      | "polygon"
      | "star"
      | "text"
      | "vector"
      | "path";
  }
> {
  return "fills" in node.properties && "strokes" in node.properties;
}

function failure(
  code: StyleOperationFailureCode,
  message: string,
): StyleOperationPlan {
  return { ok: false, code, message };
}

function sameLibraryIdentity(
  current: DesignDocument["libraryStylesById"][string]["source"],
  next: DesignDocument["libraryStylesById"][string]["source"],
): boolean {
  return (
    current.libraryId === next.libraryId &&
    current.sourceProjectId === next.sourceProjectId &&
    current.sourceDesignFileId === next.sourceDesignFileId &&
    current.sourceDocumentId === next.sourceDocumentId &&
    current.sourceStyleId === next.sourceStyleId
  );
}
