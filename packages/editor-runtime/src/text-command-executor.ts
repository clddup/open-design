import type {
  DesignDocument,
  DesignNode,
  DesignOperation,
  FidelityWarning,
  TextRunStyle,
} from "@opendesign/design-contracts";
import { styleDefinition } from "@opendesign/style-service";
import {
  validateTextFontAvailabilityResult,
  validateTextFirstBaselineResult,
  validateTextLayoutResult,
  validateTextRunLayoutResult,
  type TextFontAvailabilityResult,
  type TextFontDescriptor,
  type TextLayoutProvider,
  type TextLayoutRequest,
  type TextRunLayoutProvider,
  type TextRunLayoutStyle,
} from "@opendesign/text-service";
import { escapeJsonPointer, nodeNotFound } from "./command-document.js";
import { isEffectivelyLocked } from "./layer-operations.js";
import { OperationError } from "./operation-error.js";
import {
  commitTextEditingSession,
  normalizeTextNodeRuns,
  prepareTextPropertiesUpdate,
  textRunBaseStyle,
  updateTextRangeStyle,
} from "./rich-text-operations.js";
import {
  normalizeTextResizeProperties,
  textLayoutAffected,
} from "./text-layout-operations.js";

export type RuntimeTextRunStyle = TextRunLayoutStyle & { fill: unknown };

export interface TextCommandContext {
  textLayoutProvider?: TextLayoutProvider;
  textRunLayoutProvider?: TextRunLayoutProvider<RuntimeTextRunStyle>;
  warnings: FidelityWarning[];
}

type TextNode = Extract<DesignNode, { kind: "text" }>;
type UpdatePropertiesCommand = Extract<
  DesignOperation,
  { type: "update_properties" }
>;

export function inspectTextFontAvailability(
  provider: TextLayoutProvider | undefined,
  descriptor: TextFontDescriptor,
): TextFontAvailabilityResult {
  if (!provider?.inspectFont) {
    return {
      status: "unknown",
      provider: provider?.id ?? "editor-runtime",
      providerVersion: provider?.version ?? "unavailable",
      message:
        "Font availability is unavailable until the canvas provider is ready",
    };
  }
  try {
    const result = provider.inspectFont(descriptor);
    if (
      validateTextFontAvailabilityResult(result) ||
      result.provider !== provider.id ||
      result.providerVersion !== provider.version
    ) {
      return {
        status: "unknown",
        provider: provider.id,
        providerVersion: provider.version,
        message: "Font availability provider returned an inconsistent result",
      };
    }
    return structuredClone(result);
  } catch {
    return {
      status: "unknown",
      provider: provider.id,
      providerVersion: provider.version,
      message: "Font availability provider could not inspect this font",
    };
  }
}

export function applyTextCommand(
  document: DesignDocument,
  command: DesignOperation,
  context: TextCommandContext,
): boolean {
  switch (command.type) {
    case "reflow_text":
      reflowText(document, command, context);
      return true;
    case "update_text_range_style":
      applyTextRangeStyleOperation(document, command, context);
      return true;
    case "commit_text_edit":
      applyTextEditingSessionOperation(document, command, context);
      return true;
    default:
      return false;
  }
}

export function prepareInsertedTextNode(
  node: TextNode,
  commandId: string,
  context: TextCommandContext,
): void {
  normalizeTextNodeRuns(node, commandId);
  normalizeTextResizeProperties(node.properties);
  resolveTextAutoSize(node, commandId, context);
}

export function prepareTextNodePropertyUpdate(
  node: TextNode,
  command: UpdatePropertiesCommand,
): void {
  prepareTextPropertiesUpdate(node, command.properties, command.commandId);
}

export function finalizeTextNodePropertyUpdate(
  node: TextNode,
  command: UpdatePropertiesCommand,
  context: TextCommandContext,
): void {
  const requestedResize = command.properties?.textResize;
  if (command.size !== undefined && requestedResize === undefined) {
    node.properties.textResize = "fixed";
    if (node.properties.textWrap === "none") node.properties.textWrap = "word";
  }
  normalizeTextResizeProperties(node.properties);
  if (textLayoutAffected(command, requestedResize)) {
    resolveTextAutoSize(node, command.commandId, context);
  }
}

function reflowText(
  document: DesignDocument,
  command: Extract<DesignOperation, { type: "reflow_text" }>,
  context: TextCommandContext,
): void {
  const font = command.replacementFont ?? command.expectedFont;
  const fontAvailability = inspectReflowFont(context, font, command.commandId);
  let changed = false;
  for (const nodeId of command.nodeIds) {
    const node = document.nodesById[nodeId];
    if (!node) throw nodeNotFound(command.commandId, nodeId);
    if (node.kind !== "text") {
      throw new OperationError(
        command.commandId,
        `Node ${nodeId} is not a Text layer`,
        "invalid",
        { path: `/nodesById/${escapeJsonPointer(nodeId)}` },
      );
    }
    if (isEffectivelyLocked(document, nodeId)) {
      throw new OperationError(
        command.commandId,
        `Text layer ${nodeId} is locked`,
        "permission-denied",
        { path: `/nodesById/${escapeJsonPointer(nodeId)}/locked` },
      );
    }
    if (
      node.properties.fontFamily !== command.expectedFont.fontFamily ||
      node.properties.fontStyleName !== command.expectedFont.fontStyleName ||
      node.properties.fontWeight !== command.expectedFont.fontWeight ||
      node.properties.fontSlant !== command.expectedFont.fontSlant
    ) {
      throw new OperationError(
        command.commandId,
        `Text layer ${nodeId} no longer uses the expected font`,
        "conflict",
        {
          path: `/nodesById/${escapeJsonPointer(nodeId)}/properties/fontFamily`,
          retryable: true,
          context: {
            nodeId,
            expectedFont: command.expectedFont,
            currentFont: {
              fontFamily: node.properties.fontFamily,
              fontStyleName: node.properties.fontStyleName,
              fontWeight: node.properties.fontWeight,
              fontSlant: node.properties.fontSlant,
            },
          },
        },
      );
    }
    const before = {
      fontFamily: node.properties.fontFamily,
      fontStyleName: node.properties.fontStyleName,
      fontWeight: node.properties.fontWeight,
      fontSlant: node.properties.fontSlant,
      size: structuredClone(node.size),
      runs: JSON.stringify(node.properties.runs ?? []),
    };
    if (command.replacementFont) {
      node.properties.fontFamily = command.replacementFont.fontFamily;
      node.properties.fontStyleName = command.replacementFont.fontStyleName;
      node.properties.fontWeight = command.replacementFont.fontWeight;
      node.properties.fontSlant = command.replacementFont.fontSlant;
      node.properties.runs = (node.properties.runs ?? []).map((run) =>
        run.style.fontFamily === command.expectedFont.fontFamily &&
        run.style.fontStyleName === command.expectedFont.fontStyleName &&
        run.style.fontWeight === command.expectedFont.fontWeight &&
        run.style.fontSlant === command.expectedFont.fontSlant
          ? {
              ...run,
              style: { ...run.style, ...command.replacementFont },
            }
          : run,
      );
    }
    if (fontAvailability.status === "unknown") {
      context.warnings.push({
        nodeId,
        feature: "text-layout.font-availability-unknown",
        fallback:
          "Applied the requested font and retained provider-measured bounds",
        message: fontAvailability.message,
      });
    }
    resolveTextAutoSize(node, command.commandId, context);
    changed ||=
      before.fontFamily !== node.properties.fontFamily ||
      before.fontStyleName !== node.properties.fontStyleName ||
      before.fontWeight !== node.properties.fontWeight ||
      before.fontSlant !== node.properties.fontSlant ||
      before.runs !== JSON.stringify(node.properties.runs ?? []) ||
      before.size.width !== node.size.width ||
      before.size.height !== node.size.height;
  }
  if (!changed) {
    throw new OperationError(
      command.commandId,
      "Text layout is already up to date",
      "invalid",
      { context: { code: "no-op", nodeIds: command.nodeIds } },
    );
  }
}

function applyTextRangeStyleOperation(
  document: DesignDocument,
  command: Extract<DesignOperation, { type: "update_text_range_style" }>,
  context: TextCommandContext,
): void {
  const node = document.nodesById[command.nodeId];
  if (!node) throw nodeNotFound(command.commandId, command.nodeId);
  if (node.kind !== "text") {
    throw new OperationError(
      command.commandId,
      `Node ${node.id} is not a Text layer`,
      "invalid",
      { path: `/nodesById/${escapeJsonPointer(node.id)}` },
    );
  }
  if (isEffectivelyLocked(document, node.id)) {
    throw new OperationError(
      command.commandId,
      `Text layer ${node.id} is locked`,
      "permission-denied",
      { path: `/nodesById/${escapeJsonPointer(node.id)}/locked` },
    );
  }
  let style = command.style;
  if (typeof command.style.textStyleId === "string") {
    const reference = styleDefinition(document, command.style.textStyleId);
    if (!reference) {
      throw nodeNotFound(command.commandId, command.style.textStyleId);
    }
    if (reference.styleType !== "TEXT") {
      throw new OperationError(
        command.commandId,
        `Style ${reference.id} is not a Text Style`,
        "invalid",
      );
    }
    style = {
      ...style,
      fontFamily: reference.textStyle.fontFamily,
      fontStyleName: reference.textStyle.fontStyleName,
      fontSize: reference.textStyle.fontSize,
      fontWeight: reference.textStyle.fontWeight,
      fontSlant: reference.textStyle.fontSlant,
      letterSpacing: reference.textStyle.letterSpacing,
      lineHeight: reference.textStyle.lineHeight,
      textCase: reference.textStyle.textCase,
      textDecoration: reference.textStyle.textDecoration,
      paragraphIndent: reference.textStyle.paragraphIndent,
      paragraphSpacing: reference.textStyle.paragraphSpacing,
      listSpacing: reference.textStyle.listSpacing,
    };
  }
  if (typeof command.style.fillStyleId === "string") {
    const reference = styleDefinition(document, command.style.fillStyleId);
    if (!reference) {
      throw nodeNotFound(command.commandId, command.style.fillStyleId);
    }
    if (reference.styleType !== "PAINT") {
      throw new OperationError(
        command.commandId,
        `Style ${reference.id} is not a Paint Style`,
        "invalid",
      );
    }
    style = { ...style, fills: structuredClone(reference.paints) };
  }
  updateTextRangeStyle(node, { ...command, style });
  resolveTextAutoSize(node, command.commandId, context);
}

function applyTextEditingSessionOperation(
  document: DesignDocument,
  command: Extract<DesignOperation, { type: "commit_text_edit" }>,
  context: TextCommandContext,
): void {
  const node = document.nodesById[command.nodeId];
  if (!node) throw nodeNotFound(command.commandId, command.nodeId);
  if (node.kind !== "text") {
    throw new OperationError(
      command.commandId,
      `Node ${node.id} is not a Text layer`,
      "invalid",
      { path: `/nodesById/${escapeJsonPointer(node.id)}` },
    );
  }
  if (isEffectivelyLocked(document, node.id)) {
    throw new OperationError(
      command.commandId,
      `Text layer ${node.id} is locked`,
      "permission-denied",
      { path: `/nodesById/${escapeJsonPointer(node.id)}/locked` },
    );
  }
  commitTextEditingSession(node, command);
  normalizeTextResizeProperties(node.properties);
  resolveTextAutoSize(node, command.commandId, context);
}

function inspectReflowFont(
  context: TextCommandContext,
  descriptor: TextFontDescriptor,
  commandId: string,
): TextFontAvailabilityResult {
  const provider = context.textLayoutProvider;
  if (!provider?.inspectFont) {
    throw new OperationError(
      commandId,
      "Font availability is still initializing; retry after the canvas is ready",
      "engine-failure",
      {
        retryable: true,
        context: {
          feature: "text-font-availability",
          recovery: "retry-after-canvas-ready",
        },
      },
    );
  }
  let result: TextFontAvailabilityResult;
  try {
    result = provider.inspectFont(descriptor);
  } catch (error) {
    throw new OperationError(
      commandId,
      error instanceof Error && error.message
        ? `Font availability provider failed: ${error.message}`
        : "Font availability provider failed",
      "engine-failure",
      { retryable: true, context: { provider: provider.id } },
    );
  }
  const issue = validateTextFontAvailabilityResult(result);
  if (
    issue ||
    result.provider !== provider.id ||
    result.providerVersion !== provider.version
  ) {
    throw new OperationError(
      commandId,
      issue ?? "Font availability provider returned inconsistent identity",
      "engine-failure",
      {
        retryable: true,
        context: {
          provider: provider.id,
          providerVersion: provider.version,
          resultProvider: result.provider,
          resultProviderVersion: result.providerVersion,
        },
      },
    );
  }
  if (result.status === "missing") {
    throw new OperationError(
      commandId,
      `Font ${descriptor.fontFamily} is not available to the current canvas`,
      "invalid",
      {
        context: {
          code: "font-missing",
          font: {
            fontFamily: descriptor.fontFamily,
            fontStyleName: descriptor.fontStyleName,
            fontWeight: descriptor.fontWeight,
            fontSlant: descriptor.fontSlant,
          },
          provider: provider.id,
        },
      },
    );
  }
  return result;
}

export function resolveTextAutoSize(
  node: TextNode,
  commandId: string,
  context: TextCommandContext,
): void {
  if (node.properties.textResize === "fixed") return;
  if (
    (node.properties.runs?.length ?? 0) > 0 ||
    (node.properties.paragraphRuns?.length ?? 0) > 0
  ) {
    resolveRichTextAutoSize(node, commandId, context);
    return;
  }
  const provider = context.textLayoutProvider;
  if (!provider) {
    throw new OperationError(
      commandId,
      "Text Auto Size is still initializing; retry after the canvas is ready",
      "engine-failure",
      {
        path: `/nodesById/${escapeJsonPointer(node.id)}/size`,
        retryable: true,
        context: {
          nodeId: node.id,
          feature: "text-auto-size",
          recovery: "retry-after-canvas-ready",
        },
      },
    );
  }
  const request: TextLayoutRequest = {
    content: node.properties.content,
    fontFamily: node.properties.fontFamily,
    fontStyleName: node.properties.fontStyleName,
    fontSize: node.properties.fontSize,
    fontWeight: node.properties.fontWeight,
    fontSlant: node.properties.fontSlant,
    letterSpacing: node.properties.letterSpacing,
    lineHeight: node.properties.lineHeight,
    paragraphIndent: node.properties.paragraphIndent,
    paragraphSpacing: node.properties.paragraphSpacing,
    textCase: node.properties.textCase,
    textDecoration: node.properties.textDecoration,
    textTruncation: node.properties.textTruncation,
    maxLines: node.properties.maxLines,
    mode: node.properties.textResize,
    textWrap: node.properties.textWrap,
    ...(node.properties.textResize === "auto-height"
      ? { width: node.size.width }
      : {}),
  };
  let result: ReturnType<TextLayoutProvider["measure"]>;
  try {
    result = provider.measure(request);
  } catch (error) {
    throw new OperationError(
      commandId,
      error instanceof Error && error.message
        ? `Text layout provider failed: ${error.message}`
        : "Text layout provider failed",
      "engine-failure",
      {
        path: `/nodesById/${escapeJsonPointer(node.id)}/size`,
        retryable: true,
        context: {
          nodeId: node.id,
          provider: provider.id,
          providerVersion: provider.version,
          providerCode: "provider-threw",
        },
      },
    );
  }
  const resultIssue = validateTextLayoutResult(result);
  if (resultIssue) {
    throw new OperationError(
      commandId,
      `Text layout provider returned an invalid result: ${resultIssue}`,
      "engine-failure",
      {
        path: `/nodesById/${escapeJsonPointer(node.id)}/size`,
        retryable: true,
        context: {
          nodeId: node.id,
          provider: provider.id,
          providerVersion: provider.version,
        },
      },
    );
  }
  if (!result.ok) {
    throw new OperationError(commandId, result.message, "engine-failure", {
      path: `/nodesById/${escapeJsonPointer(node.id)}/size`,
      retryable: result.retryable,
      context: {
        nodeId: node.id,
        provider: provider.id,
        providerVersion: provider.version,
        providerCode: result.code,
      },
    });
  }
  if (
    result.provider !== provider.id ||
    result.providerVersion !== provider.version
  ) {
    throw new OperationError(
      commandId,
      "Text layout provider returned inconsistent identity",
      "engine-failure",
      {
        path: `/nodesById/${escapeJsonPointer(node.id)}/size`,
        context: {
          nodeId: node.id,
          provider: provider.id,
          providerVersion: provider.version,
          resultProvider: result.provider,
          resultProviderVersion: result.providerVersion,
        },
      },
    );
  }
  node.size = structuredClone(result.size);
  context.warnings.push(
    ...result.warnings.map((warning) => ({
      nodeId: node.id,
      feature: `text-layout.${warning.code}`,
      fallback: warning.fallback,
      message: warning.message,
    })),
  );
}

export function resolveTextFirstBaseline(
  node: TextNode,
  commandId: string,
  context: TextCommandContext,
  size: { width: number; height: number } = node.size,
): number {
  const path = `/nodesById/${escapeJsonPointer(node.id)}/properties`;
  if (
    (node.properties.runs?.length ?? 0) > 0 ||
    (node.properties.paragraphRuns?.length ?? 0) > 0
  ) {
    const provider = context.textRunLayoutProvider;
    if (!provider) {
      throw new OperationError(
        commandId,
        "Rich text baseline measurement is still initializing; retry after the canvas is ready",
        "engine-failure",
        { path, retryable: true },
      );
    }
    if (node.properties.textAlignHorizontal === "justify") {
      throw new OperationError(
        commandId,
        "Rich text baseline measurement does not support justified alignment yet",
        "unsupported",
        {
          path: `/nodesById/${escapeJsonPointer(node.id)}/properties/textAlignHorizontal`,
        },
      );
    }
    const request = {
      baseStyle: runtimeTextRunStyle(textRunBaseStyle(node)),
      content: node.properties.content,
      mode: node.properties.textResize,
      paragraphIndent: node.properties.paragraphIndent,
      paragraphSpacing: node.properties.paragraphSpacing,
      listSpacing: node.properties.listSpacing,
      hangingList: node.properties.hangingList,
      paragraphRuns: node.properties.paragraphRuns ?? [],
      runs: (node.properties.runs ?? []).map((run) => ({
        ...run,
        style: runtimeTextRunStyle(run.style),
      })),
      textAlignHorizontal: node.properties.textAlignHorizontal,
      textAlignVertical: node.properties.textAlignVertical,
      textWrap: node.properties.textWrap,
      ...(node.properties.textResize === "auto-width"
        ? {}
        : { width: size.width }),
      ...(node.properties.textResize === "fixed"
        ? { height: size.height }
        : {}),
    } as const;
    const result = provider.layout(request);
    const issue = validateTextRunLayoutResult(result, request);
    if (issue || !result.ok) {
      throw new OperationError(
        commandId,
        issue ??
          (result.ok ? "Text baseline measurement failed" : result.message),
        "engine-failure",
        { path, retryable: !result.ok ? result.retryable : true },
      );
    }
    if (
      result.provider !== provider.id ||
      result.providerVersion !== provider.version
    ) {
      throw new OperationError(
        commandId,
        "Rich text baseline provider returned inconsistent identity",
        "engine-failure",
        { path, retryable: true },
      );
    }
    const firstLine = result.lines[0];
    return firstLine ? firstLine.y + firstLine.baseline : 0;
  }
  const provider = context.textLayoutProvider;
  if (!provider?.measureFirstBaseline) {
    throw new OperationError(
      commandId,
      "Text baseline measurement is still initializing; retry after the canvas is ready",
      "engine-failure",
      { path, retryable: true },
    );
  }
  const request = {
    content: node.properties.content,
    fontFamily: node.properties.fontFamily,
    fontStyleName: node.properties.fontStyleName,
    fontSize: node.properties.fontSize,
    fontWeight: node.properties.fontWeight,
    fontSlant: node.properties.fontSlant,
    letterSpacing: node.properties.letterSpacing,
    lineHeight: node.properties.lineHeight,
    paragraphIndent: node.properties.paragraphIndent,
    paragraphSpacing: node.properties.paragraphSpacing,
    textCase: node.properties.textCase,
    textDecoration: node.properties.textDecoration,
    textTruncation: node.properties.textTruncation,
    maxLines: node.properties.maxLines,
    mode: node.properties.textResize,
    textWrap: node.properties.textWrap,
    textAlignVertical: node.properties.textAlignVertical,
    width: size.width,
    height: size.height,
  } as const;
  const result = provider.measureFirstBaseline(request);
  const issue = validateTextFirstBaselineResult(result);
  if (issue || !result.ok) {
    throw new OperationError(
      commandId,
      issue ??
        (result.ok ? "Text baseline measurement failed" : result.message),
      "engine-failure",
      { path, retryable: !result.ok ? result.retryable : true },
    );
  }
  if (
    result.provider !== provider.id ||
    result.providerVersion !== provider.version
  ) {
    throw new OperationError(
      commandId,
      "Text baseline provider returned inconsistent identity",
      "engine-failure",
      { path, retryable: true },
    );
  }
  return result.baseline;
}

function resolveRichTextAutoSize(
  node: TextNode,
  commandId: string,
  context: TextCommandContext,
): void {
  const provider = context.textRunLayoutProvider;
  const path = `/nodesById/${escapeJsonPointer(node.id)}/size`;
  if (!provider) {
    throw new OperationError(
      commandId,
      "Rich Text Auto Size is still initializing; retry after the canvas is ready",
      "engine-failure",
      {
        path,
        retryable: true,
        context: {
          nodeId: node.id,
          feature: "rich-text-auto-size",
          recovery: "retry-after-canvas-ready",
        },
      },
    );
  }
  if (node.properties.textAlignHorizontal === "justify") {
    throw new OperationError(
      commandId,
      "Rich Text Auto Size does not support justified alignment yet",
      "unsupported",
      {
        path: `/nodesById/${escapeJsonPointer(node.id)}/properties/textAlignHorizontal`,
      },
    );
  }
  if (node.properties.textTruncation !== "disabled") {
    throw new OperationError(
      commandId,
      "Rich Text Auto Size does not support ending truncation yet",
      "unsupported",
      {
        path: `/nodesById/${escapeJsonPointer(node.id)}/properties/textTruncation`,
      },
    );
  }
  const request = {
    baseStyle: runtimeTextRunStyle(textRunBaseStyle(node)),
    content: node.properties.content,
    mode: node.properties.textResize,
    paragraphIndent: node.properties.paragraphIndent,
    paragraphSpacing: node.properties.paragraphSpacing,
    listSpacing: node.properties.listSpacing,
    hangingList: node.properties.hangingList,
    paragraphRuns: node.properties.paragraphRuns ?? [],
    runs: (node.properties.runs ?? []).map((run) => ({
      ...run,
      style: runtimeTextRunStyle(run.style),
    })),
    textAlignHorizontal: node.properties.textAlignHorizontal,
    textAlignVertical: node.properties.textAlignVertical,
    textWrap: node.properties.textWrap,
    ...(node.properties.textResize === "auto-height"
      ? { width: node.size.width }
      : {}),
  } as const;
  let result: ReturnType<typeof provider.layout>;
  try {
    result = provider.layout(request);
  } catch (error) {
    throw new OperationError(
      commandId,
      error instanceof Error && error.message
        ? `Rich text layout provider failed: ${error.message}`
        : "Rich text layout provider failed",
      "engine-failure",
      { path, retryable: true, context: { provider: provider.id } },
    );
  }
  const issue = validateTextRunLayoutResult(result, request);
  if (issue) {
    throw new OperationError(commandId, issue, "engine-failure", {
      path,
      retryable: true,
      context: { provider: provider.id, providerVersion: provider.version },
    });
  }
  if (!result.ok) {
    throw new OperationError(
      commandId,
      result.message,
      result.code === "unsupported" ? "unsupported" : "engine-failure",
      {
        path,
        retryable: result.retryable,
        context: { provider: provider.id, providerVersion: provider.version },
      },
    );
  }
  if (
    result.provider !== provider.id ||
    result.providerVersion !== provider.version
  ) {
    throw new OperationError(
      commandId,
      "Rich text layout provider returned inconsistent identity",
      "engine-failure",
      { path, retryable: true },
    );
  }
  node.size = structuredClone(result.size);
  for (const warning of result.warnings) {
    context.warnings.push({
      nodeId: node.id,
      feature: `text-layout.${warning.code}`,
      fallback: warning.fallback,
      message: warning.message,
    });
  }
}

function runtimeTextRunStyle(style: TextRunStyle): RuntimeTextRunStyle {
  return { ...style, fill: structuredClone(style.fills) };
}
