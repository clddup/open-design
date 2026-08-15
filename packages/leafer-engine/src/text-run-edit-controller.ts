import type {
  DesignDocument,
  DesignNode,
  DesignOperation,
  TextRun,
  TextRunStyle,
} from "@opendesign/design-contracts";
import {
  applyTextEditingListCommand,
  applyTextEditingSessionInput,
  createRichTextEditingSession,
  finalizeTextEditingSession,
  inspectTextEditingSelection,
  undoAutomaticTextList,
  updateTextEditingCharacterStyle,
  updateTextEditingParagraphStyle,
  updateTextEditingSelection,
  type TextEditingListCommand,
  type TextEditingSelection,
  type TextEditingSelectionInspection,
  type TextEditingSessionCommandResult,
  type TextEditingSessionInputResult,
  type TextEditingSessionState,
  type TextParagraphStyle,
} from "@opendesign/text-service";
import type {
  LeaferElementSpec,
  LeaferSceneProjection,
} from "./projection-types.js";
import {
  textRunEditProxyElementId,
  textRunFragmentElementIds,
} from "./text-run-projection.js";

type TextNode = Extract<DesignNode, { kind: "text" }>;
type TextStyleUpdate = Extract<
  DesignOperation,
  { type: "update_text_range_style" }
>["style"];
type CharacterStyleUpdate = Partial<
  Omit<TextRunStyle, "fillStyleId" | "textStyleId">
> & {
  fillStyleId?: string | null;
  textStyleId?: string | null;
};

export interface TextRunEditElement {
  forceUpdate(boundsType?: string): void;
  set(data: Record<string, unknown>): void;
}

export interface TextRunEditCurrentState {
  baseProjection: LeaferSceneProjection | null;
  document: DesignDocument | null;
  projection: LeaferSceneProjection | null;
}

export interface TextRunEditControllerEnvironment<
  Element extends TextRunEditElement,
> {
  applySpecData(
    element: Element,
    spec: LeaferElementSpec,
    overrides?: Record<string, unknown>,
  ): void;
  current(): TextRunEditCurrentState;
  element(projectionId: string): Element | undefined;
  openProxy(projectionId: string): void;
  readText(element: Element): string;
  scheduleBounds(nodeId: string): void;
  writeText(element: Element, content: string): void;
}

export interface TextEditBefore {
  documentId: string;
  nodeId: string;
  revision: number;
  text: string;
}

export type TextEditFinishResult =
  | { kind: "none" }
  | { kind: "restore" }
  | {
      before: TextEditBefore;
      content: string;
      kind: "commit";
      node: TextNode;
      paragraphPatches: ReturnType<
        typeof finalizeTextEditingSession
      >["paragraphPatches"];
      runs?: TextRun[];
    };

interface TextRunEditPresentation {
  documentId: string;
  fragmentIds: string[];
  nodeId: string;
  pendingCommit: boolean;
}

/**
 * Owns the short-lived interaction state that makes disposable native Text
 * fragments behave as one authoritative OpenDesign Text node. It never owns
 * document data and can only ask the Adapter to show, edit, or restore the
 * current exact-revision projection.
 */
export class TextRunEditController<Element extends TextRunEditElement> {
  readonly #environment: TextRunEditControllerEnvironment<Element>;
  #before: TextEditBefore | null = null;
  #cancelled = false;
  #pendingProxyId: string | null = null;
  #presentation: TextRunEditPresentation | null = null;
  #session: TextEditingSessionState<TextRunStyle> | null = null;

  constructor(environment: TextRunEditControllerEnvironment<Element>) {
    this.#environment = environment;
  }

  get activeNodeId(): string | null {
    return this.#before?.nodeId ?? null;
  }

  get activeContent(): string | null {
    return this.#session?.content ?? null;
  }

  get activeSelection(): TextEditingSelection | null {
    return this.#session ? { ...this.#session.selection } : null;
  }

  get activeRuns(): readonly TextRun[] | null {
    return this.#session?.character
      ? structuredClone(this.#session.character.runs)
      : null;
  }

  get hasTypingStyle(): boolean {
    return this.#session?.character?.typingStyle != null;
  }

  get activeTypingStyle(): TextRunStyle | null {
    const style = this.#session?.character?.typingStyle?.style;
    return style ? structuredClone(style) : null;
  }

  beforeEditInner(projectionId: string | undefined): false | undefined {
    const { projection } = this.#environment.current();
    if (!projection || !projectionId) return undefined;
    const proxyId = textRunEditProxyElementId(projection, projectionId);
    if (!proxyId) return undefined;
    if (isLockedSpec(projection.elementsById.get(proxyId))) return false;
    if (proxyId === projectionId) return undefined;
    if (this.#pendingProxyId === proxyId) return false;

    this.#pendingProxyId = proxyId;
    const requestedProjection = projection;
    queueMicrotask(() => {
      if (this.#pendingProxyId !== proxyId) return;
      this.#pendingProxyId = null;
      const current = this.#environment.current();
      if (
        current.projection !== requestedProjection ||
        textRunEditProxyElementId(requestedProjection, projectionId) !==
          proxyId ||
        !this.#environment.element(proxyId)
      ) {
        return;
      }
      this.#environment.openProxy(proxyId);
    });
    return false;
  }

  begin(nodeId: string): boolean {
    const current = this.#environment.current();
    const node = current.document?.nodesById[nodeId];
    const proxy = this.#environment.element(nodeId);
    const spec = current.projection?.elementsById.get(nodeId);
    if (
      !current.document ||
      !node ||
      node.kind !== "text" ||
      !proxy ||
      isLockedSpec(spec)
    ) {
      return false;
    }
    this.#beginPresentation(nodeId, current);
    this.#environment.writeText(proxy, node.properties.content);
    this.#before = {
      documentId: current.document.documentId,
      nodeId,
      revision: current.document.revision,
      text: node.properties.content,
    };
    this.#session = createRichTextEditingSession(
      node.properties.content,
      node.properties.runs ?? [],
      textRunBaseStyle(node),
      node.properties.paragraphRuns ?? [],
      {
        listOptions: { type: "none" },
        indentation: 0,
        listSpacing: node.properties.listSpacing,
        paragraphIndent: node.properties.paragraphIndent,
        paragraphSpacing: node.properties.paragraphSpacing,
      },
    );
    this.#cancelled = false;
    return true;
  }

  selection(
    selection: TextEditingSelection,
  ): TextEditingSelectionInspection<TextRunStyle> | null {
    const before = this.#before;
    const current = this.#environment.current();
    if (
      !before ||
      !this.#session ||
      current.document?.documentId !== before.documentId ||
      current.document.revision !== before.revision
    ) {
      return null;
    }
    this.#session = updateTextEditingSelection(this.#session, selection);
    return inspectTextEditingSelection(this.#session, selection);
  }

  updateStyle(style: TextStyleUpdate): {
    changed: boolean;
    characterChanged: boolean;
  } {
    if (!this.#session || Object.keys(style).length === 0) {
      return { changed: false, characterChanged: false };
    }
    const selection = this.#session.selection;
    const character = characterStyleUpdate(style);
    const paragraph = paragraphStyleUpdate(style);
    const characterChanged = Object.keys(character).length > 0;
    let next = this.#session;
    if (characterChanged) {
      next = updateTextEditingCharacterStyle(next, selection, (current) =>
        patchTextRunStyle(current, character),
      );
    }
    if (Object.keys(paragraph).length > 0) {
      next = updateTextEditingParagraphStyle(next, selection, (current) => ({
        ...current,
        ...paragraph,
        ...(paragraph.listOptions
          ? { listOptions: structuredClone(paragraph.listOptions) }
          : {}),
      }));
    }
    this.#session = next;
    return { changed: true, characterChanged };
  }

  input(
    content: string,
    selection: TextEditingSelection,
    automaticList: boolean,
  ): TextEditingSessionInputResult<TextRunStyle> | null {
    if (!this.#session) return null;
    const result = applyTextEditingSessionInput(
      this.#session,
      content,
      selection,
      { automaticList },
    );
    this.#session = result.state;
    return result;
  }

  listCommand(
    selection: TextEditingSelection,
    command: TextEditingListCommand,
  ): TextEditingSessionCommandResult<TextRunStyle> | null {
    if (!this.#session) return null;
    const result = applyTextEditingListCommand(
      this.#session,
      selection,
      command,
    );
    this.#session = result.state;
    return result;
  }

  undoAutomaticList(): TextEditingSessionInputResult<TextRunStyle> | null {
    if (!this.#session) return null;
    const result = undoAutomaticTextList(this.#session);
    if (result) this.#session = result.state;
    return result;
  }

  cancel(): void {
    if (this.#before) this.#cancelled = true;
  }

  finish(options: {
    disposed: boolean;
    synchronizing: boolean;
  }): TextEditFinishResult {
    const before = this.#before;
    this.#before = null;
    if (!before || options.disposed) {
      this.#session = null;
      this.#cancelled = false;
      if (options.disposed) this.#presentation = null;
      return { kind: "none" };
    }
    if (options.synchronizing) {
      this.#session = null;
      this.#cancelled = false;
      this.#presentation = null;
      return { kind: "restore" };
    }

    const current = this.#environment.current();
    const element = this.#environment.element(before.nodeId);
    const node = current.document?.nodesById[before.nodeId];
    const spec = current.projection?.elementsById.get(before.nodeId);
    if (
      !current.document ||
      current.document.documentId !== before.documentId ||
      current.document.revision !== before.revision ||
      !element ||
      !node ||
      node.kind !== "text" ||
      isLockedSpec(spec)
    ) {
      this.#session = null;
      this.restorePresentation();
      return { kind: "restore" };
    }
    const content = this.#environment.readText(element);
    if (this.#session && content !== this.#session.content) {
      this.#session = applyTextEditingSessionInput(
        this.#session,
        content,
        { start: content.length, end: content.length },
        { automaticList: false },
      ).state;
    }
    const commit = this.#session
      ? finalizeTextEditingSession(this.#session)
      : { content, paragraphPatches: [] };
    this.#session = null;
    if (
      this.#cancelled ||
      (commit.content === before.text &&
        commit.paragraphPatches.length === 0 &&
        commit.runs === undefined)
    ) {
      this.#cancelled = false;
      this.restorePresentation();
      return { kind: "restore" };
    }
    this.#cancelled = false;
    return {
      before,
      content: commit.content,
      kind: "commit",
      node,
      paragraphPatches: commit.paragraphPatches,
      ...(commit.runs ? { runs: commit.runs } : {}),
    };
  }

  completeCommit(
    result: Extract<TextEditFinishResult, { kind: "commit" }>,
    accepted: boolean,
  ): void {
    if (!accepted) {
      this.restorePresentation();
      return;
    }
    const current = this.#environment.current();
    if (
      this.#presentation &&
      current.document?.documentId === result.before.documentId &&
      current.document.revision === result.before.revision
    ) {
      this.#presentation.pendingCommit = true;
      this.syncPresentation();
    } else {
      // The Runtime may publish the accepted revision synchronously from the
      // onOperations callback. Reapply that new exact projection instead of
      // leaving its fragments hidden by the still-open presentation state.
      this.restorePresentation();
    }
  }

  handleProjectionChange(options: {
    documentChanged: boolean;
    identityChanged: boolean;
    projectionChanged: boolean;
  }): void {
    if (options.identityChanged) this.#pendingProxyId = null;
    if (
      this.#presentation?.pendingCommit &&
      (options.documentChanged || options.projectionChanged)
    ) {
      this.#presentation = null;
    }
  }

  syncPresentation(): void {
    const presentation = this.#presentation;
    const current = this.#environment.current();
    if (
      !presentation ||
      !current.document ||
      !current.projection ||
      !current.baseProjection
    ) {
      return;
    }
    const node = current.document.nodesById[presentation.nodeId];
    const proxy = this.#environment.element(presentation.nodeId);
    const baseSpec = current.baseProjection.elementsById.get(
      presentation.nodeId,
    );
    if (
      current.document.documentId !== presentation.documentId ||
      !node ||
      node.kind !== "text" ||
      !proxy ||
      !baseSpec ||
      baseSpec.kind !== "text" ||
      textRunEditProxyElementId(current.projection, presentation.nodeId) !==
        presentation.nodeId
    ) {
      this.#presentation = null;
      return;
    }

    presentation.fragmentIds = textRunFragmentElementIds(
      current.projection,
      presentation.nodeId,
    );
    this.#environment.applySpecData(proxy, baseSpec, {
      text: this.#environment.readText(proxy),
    });
    for (const fragmentId of presentation.fragmentIds) {
      this.#environment.element(fragmentId)?.set({
        hittable: false,
        visible: false,
      });
    }
    proxy.forceUpdate("bounds");
    this.#environment.scheduleBounds(presentation.nodeId);
  }

  restorePresentation(): void {
    const presentation = this.#presentation;
    this.#presentation = null;
    const { projection } = this.#environment.current();
    if (!presentation || !projection) return;
    for (const projectionId of [
      presentation.nodeId,
      ...presentation.fragmentIds,
    ]) {
      const element = this.#environment.element(projectionId);
      const spec = projection.elementsById.get(projectionId);
      if (element && spec) this.#environment.applySpecData(element, spec);
    }
    this.#environment.element(presentation.nodeId)?.forceUpdate("bounds");
    this.#environment.scheduleBounds(presentation.nodeId);
  }

  clear(): void {
    this.#before = null;
    this.#cancelled = false;
    this.#pendingProxyId = null;
    this.#presentation = null;
    this.#session = null;
  }

  #beginPresentation(nodeId: string, current: TextRunEditCurrentState): void {
    if (
      !current.document ||
      !current.projection ||
      textRunEditProxyElementId(current.projection, nodeId) !== nodeId
    ) {
      this.#presentation = null;
      return;
    }
    this.#presentation = {
      documentId: current.document.documentId,
      fragmentIds: textRunFragmentElementIds(current.projection, nodeId),
      nodeId,
      pendingCommit: false,
    };
    this.syncPresentation();
  }
}

function isLockedSpec(spec: LeaferElementSpec | undefined): boolean {
  const metadata = spec?.data.data;
  return (
    typeof metadata === "object" &&
    metadata !== null &&
    (metadata as Record<string, unknown>).opendesignLocked === true
  );
}

const CHARACTER_STYLE_FIELDS = new Set([
  "fontFamily",
  "fontStyleName",
  "fontSize",
  "fontWeight",
  "fontSlant",
  "letterSpacing",
  "lineHeight",
  "textCase",
  "textDecoration",
  "fills",
  "textStyleId",
  "fillStyleId",
]);
const PARAGRAPH_STYLE_FIELDS = new Set([
  "listOptions",
  "indentation",
  "listSpacing",
  "paragraphIndent",
  "paragraphSpacing",
]);

function characterStyleUpdate(style: TextStyleUpdate): CharacterStyleUpdate {
  return filterStyleFields(style, CHARACTER_STYLE_FIELDS);
}

function paragraphStyleUpdate(
  style: TextStyleUpdate,
): Partial<TextParagraphStyle> {
  return filterStyleFields(style, PARAGRAPH_STYLE_FIELDS);
}

function filterStyleFields<Result extends object>(
  style: TextStyleUpdate,
  fields: ReadonlySet<string>,
): Result {
  return Object.fromEntries(
    Object.entries(style).filter(([field]) => fields.has(field)),
  ) as Result;
}

function patchTextRunStyle(
  current: TextRunStyle,
  update: CharacterStyleUpdate,
): TextRunStyle {
  const { fillStyleId, textStyleId, ...values } = update;
  const next: TextRunStyle = { ...current, ...values };
  if (Object.hasOwn(update, "textStyleId")) {
    if (textStyleId === null) delete next.textStyleId;
    else if (textStyleId !== undefined) next.textStyleId = textStyleId;
  }
  if (Object.hasOwn(update, "fillStyleId")) {
    if (fillStyleId === null) delete next.fillStyleId;
    else if (fillStyleId !== undefined) next.fillStyleId = fillStyleId;
  }
  return next;
}

function textRunBaseStyle(node: TextNode): TextRunStyle {
  return {
    fontFamily: node.properties.fontFamily,
    fontStyleName: node.properties.fontStyleName,
    fontSize: node.properties.fontSize,
    fontWeight: node.properties.fontWeight,
    fontSlant: node.properties.fontSlant,
    letterSpacing: node.properties.letterSpacing,
    lineHeight: node.properties.lineHeight,
    textCase: node.properties.textCase,
    textDecoration: node.properties.textDecoration,
    fills: structuredClone(node.properties.fills),
    ...(node.textStyleId ? { textStyleId: node.textStyleId } : {}),
    ...(node.fillStyleId ? { fillStyleId: node.fillStyleId } : {}),
  };
}
