import type {
  DesignDocument,
  TextRunStyle,
} from "@opendesign/design-contracts";
import type { TextEditingListCommand } from "@opendesign/text-service";
import type {
  TextRunEditController,
  TextRunEditElement,
} from "./text-run-edit-controller.js";
import type {
  LeaferTextRangeSelection,
  LeaferTextStyleUpdate,
} from "./types.js";

export interface TextEditDomControllerEnvironment<
  Element extends TextRunEditElement,
> {
  currentDocument(): DesignDocument | null;
  editor: TextRunEditController<Element>;
  element(nodeId: string): Element | undefined;
  publish(selection: LeaferTextRangeSelection | null): void;
  report(error: unknown): void;
  writeText(element: Element, content: string): void;
}

/**
 * Owns the browser DOM side of one native TextEditor session: DOM identity,
 * selection offsets, IME composition, temporary typing-style markers and
 * list keyboard commands. The composed TextRunEditController remains the only
 * owner of rich-text session state; neither DOM content nor markers are
 * document/history facts.
 */
export class TextEditDomController<Element extends TextRunEditElement> {
  readonly #environment: TextEditDomControllerEnvironment<Element>;
  readonly #onSelectionChange = () => this.publishSelection();
  #composing = false;
  #root: HTMLDivElement | null = null;

  constructor(environment: TextEditDomControllerEnvironment<Element>) {
    this.#environment = environment;
  }

  get active(): boolean {
    return this.#root !== null;
  }

  attach(root: HTMLDivElement): void {
    this.detach(false);
    this.#root = root;
    this.#composing = false;
    root.addEventListener("input", this.#onInput);
    root.addEventListener("compositionstart", this.#onCompositionStart);
    root.addEventListener("compositionend", this.#onCompositionEnd);
    root.ownerDocument.addEventListener(
      "selectionchange",
      this.#onSelectionChange,
    );
    const snapshot = textEditDomSnapshot(root);
    this.#environment.editor.selection(snapshot.selection);
    this.#renderCharacterStyles(root, snapshot.selection, true);
  }

  detach(sync: boolean): void {
    const root = this.#root;
    if (!root) return;
    if (sync) this.#sync(root, false);
    root.removeEventListener("input", this.#onInput);
    root.removeEventListener("compositionstart", this.#onCompositionStart);
    root.removeEventListener("compositionend", this.#onCompositionEnd);
    root.ownerDocument.removeEventListener(
      "selectionchange",
      this.#onSelectionChange,
    );
    this.#root = null;
    this.#composing = false;
  }

  dispose(): void {
    this.detach(false);
    this.#environment.publish(null);
  }

  cancel(): void {
    this.#environment.editor.cancel();
  }

  finish(): void {
    this.detach(false);
    this.#environment.publish(null);
  }

  updateStyle(style: LeaferTextStyleUpdate): boolean {
    const update = this.#environment.editor.updateStyle(style);
    if (!update.changed) return false;
    const root = this.#root;
    const selection = this.#environment.editor.activeSelection;
    if (root && selection && update.characterChanged) {
      const restoreSelection = shouldRestoreTextEditDomSelection(root);
      if (selection.start === selection.end) {
        const typingStyle = this.#environment.editor.activeTypingStyle;
        if (typingStyle) {
          installTextEditTypingStyleMarker(
            root,
            selection.start,
            typingStyle,
            restoreSelection,
          );
        }
      } else {
        finalizeTextEditTypingStyleMarkers(root, selection, restoreSelection);
        const runs = this.#environment.editor.activeRuns;
        if (runs) {
          applyTextEditCharacterStylesInPlace(
            root,
            selection,
            runs,
            restoreSelection,
          );
        }
      }
    }
    if (selection) this.#publishActiveSelection(selection);
    return true;
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    const root = this.#root;
    if (
      !root ||
      !isNode(event.target) ||
      !root.contains(event.target) ||
      this.#composing ||
      event.isComposing
    ) {
      return false;
    }
    try {
      const snapshot = textEditDomSnapshot(root);
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "z"
      ) {
        const undone = this.#environment.editor.undoAutomaticList();
        if (!undone?.rewrite) return false;
        stopTextEditKey(event);
        this.#applyRewrite(root, undone.rewrite);
        this.publishSelection();
        return true;
      }
      const command = textEditingListCommand(event);
      if (!command) return false;
      const result = this.#environment.editor.listCommand(
        snapshot.selection,
        command,
      );
      if (!result?.handled) return false;
      stopTextEditKey(event);
      this.#writeActiveContent(result.state.content);
      this.publishSelection();
      return true;
    } catch (error) {
      this.#environment.report(error);
      this.cancel();
      return false;
    }
  }

  publishSelection(): void {
    const root = this.#root;
    const nodeId = this.#environment.editor.activeNodeId;
    const selection = root?.ownerDocument.getSelection();
    if (!root || !nodeId || !selection || selection.rangeCount === 0) {
      return;
    }
    const range = selection.getRangeAt(0);
    if (
      !root.contains(range.startContainer) ||
      !root.contains(range.endContainer)
    ) {
      return;
    }
    const snapshot = textEditDomSnapshot(root);
    if (snapshot.content !== this.#environment.editor.activeContent) return;
    this.#publishActiveSelection(snapshot.selection);
    if (!this.#environment.editor.hasTypingStyle) {
      finalizeTextEditTypingStyleMarkers(
        root,
        snapshot.selection,
        shouldRestoreTextEditDomSelection(root),
      );
    }
  }

  #publishActiveSelection(selection: { start: number; end: number }): void {
    const document = this.#environment.currentDocument();
    const nodeId = this.#environment.editor.activeNodeId;
    const authoritative = nodeId ? document?.nodesById[nodeId] : undefined;
    if (!document || !nodeId || authoritative?.kind !== "text") {
      this.#environment.publish(null);
      return;
    }
    const inspection = this.#environment.editor.selection(selection);
    if (!inspection) {
      this.#environment.publish(null);
      return;
    }
    this.#environment.publish({
      documentId: document.documentId,
      editing: {
        characterMixedFields: inspection.characterMixedFields,
        characterStyle: inspection.characterStyle,
        content:
          this.#environment.editor.activeContent ??
          authoritative.properties.content,
        paragraphMixedFields: inspection.paragraphMixedFields,
        paragraphStyle: inspection.paragraphStyle,
      },
      nodeId,
      revision: document.revision,
      ...selection,
    });
  }

  #onInput = (event: Event): void => {
    const input = event as InputEvent;
    this.#sync(
      event.currentTarget as HTMLDivElement,
      !this.#composing &&
        input.isComposing !== true &&
        input.inputType === "insertText" &&
        input.data === " ",
    );
  };

  #onCompositionStart = (): void => {
    this.#composing = true;
  };

  #onCompositionEnd = (): void => {
    this.#composing = false;
    if (this.#root) this.#sync(this.#root, false);
  };

  #sync(root: HTMLDivElement, automaticList: boolean): void {
    if (root !== this.#root || !this.#environment.editor.activeNodeId) return;
    try {
      const snapshot = textEditDomSnapshot(root);
      const result = this.#environment.editor.input(
        snapshot.content,
        snapshot.selection,
        automaticList,
      );
      if (!result) return;
      if (result.rewrite) this.#applyRewrite(root, result.rewrite);
      else this.#writeActiveContent(result.state.content);
      this.publishSelection();
    } catch (error) {
      this.#environment.report(error);
      this.cancel();
    }
  }

  #applyRewrite(
    root: HTMLDivElement,
    rewrite: { content: string; selection: { start: number; end: number } },
  ): void {
    writeTextEditDom(root, rewrite.content);
    setTextEditDomSelection(root, rewrite.selection);
    this.#writeActiveContent(rewrite.content);
  }

  #writeActiveContent(content: string): void {
    const nodeId = this.#environment.editor.activeNodeId;
    const element = nodeId ? this.#environment.element(nodeId) : undefined;
    if (element) this.#environment.writeText(element, content);
  }

  #renderCharacterStyles(
    root: HTMLDivElement,
    selection: { start: number; end: number },
    restoreSelection: boolean,
  ): void {
    const content = this.#environment.editor.activeContent;
    const runs = this.#environment.editor.activeRuns;
    if (content === null || !runs) return;
    writeStyledTextEditDom(root, content, runs);
    if (restoreSelection) setTextEditDomSelection(root, selection);
  }
}

function textDomOffset(
  root: HTMLElement,
  target: Node,
  targetOffset: number,
): number | null {
  let total = 0;
  let resolved: number | null = null;
  const visit = (node: Node): void => {
    if (resolved !== null) return;
    if (node === target) {
      if (node.nodeType === Node.TEXT_NODE) {
        const length = node.textContent?.length ?? 0;
        resolved = total + Math.min(Math.max(targetOffset, 0), length);
      } else {
        const children = [...node.childNodes];
        for (
          let index = 0;
          index < Math.min(targetOffset, children.length);
          index += 1
        ) {
          total += textDomLength(children[index]!);
        }
        resolved = total;
      }
      return;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      total += node.textContent?.length ?? 0;
      return;
    }
    if (node instanceof HTMLBRElement) {
      total += 1;
      return;
    }
    node.childNodes.forEach(visit);
  };
  visit(root);
  return resolved;
}

function textDomLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent?.length ?? 0;
  if (node instanceof HTMLBRElement) return 1;
  return [...node.childNodes].reduce(
    (sum, child) => sum + textDomLength(child),
    0,
  );
}

function textEditDomSnapshot(root: HTMLDivElement): {
  content: string;
  rawContent: string;
  selection: { start: number; end: number };
} {
  const rawContent = textEditDomText(root);
  const content = rawContent.replaceAll("\u200B", "");
  const selection = root.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return {
      content,
      rawContent,
      selection: { start: content.length, end: content.length },
    };
  }
  const range = selection.getRangeAt(0);
  if (
    !root.contains(range.startContainer) ||
    !root.contains(range.endContainer)
  ) {
    return {
      content,
      rawContent,
      selection: { start: content.length, end: content.length },
    };
  }
  const rawStart = textDomOffset(root, range.startContainer, range.startOffset);
  const rawEnd = textDomOffset(root, range.endContainer, range.endOffset);
  if (rawStart === null || rawEnd === null) {
    throw new Error("Text edit selection is outside the active edit root");
  }
  const first = normalizedTextDomOffset(rawContent, rawStart);
  const second = normalizedTextDomOffset(rawContent, rawEnd);
  return {
    content,
    rawContent,
    selection: {
      start: Math.min(first, second),
      end: Math.max(first, second),
    },
  };
}

function textEditDomText(root: HTMLElement): string {
  return [...root.childNodes]
    .map((child) => textEditDomNodeText(child))
    .join("");
}

function textEditDomNodeText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (node instanceof HTMLBRElement) return "\n";
  return [...node.childNodes].map(textEditDomNodeText).join("");
}

function normalizedTextDomOffset(rawContent: string, offset: number): number {
  return rawContent.slice(0, offset).replaceAll("\u200B", "").length;
}

function writeTextEditDom(root: HTMLDivElement, content: string): void {
  const fragment = root.ownerDocument.createDocumentFragment();
  content.split("\n").forEach((line, index, lines) => {
    if (index > 0) fragment.appendChild(root.ownerDocument.createElement("br"));
    if (line.length > 0 || lines.length === 1) {
      fragment.appendChild(root.ownerDocument.createTextNode(line));
    }
  });
  root.replaceChildren(fragment);
}

function writeStyledTextEditDom(
  root: HTMLDivElement,
  content: string,
  runs: readonly { end: number; start: number; style: TextRunStyle }[],
): void {
  if (content.length === 0) {
    writeTextEditDom(root, content);
    return;
  }
  const fragment = root.ownerDocument.createDocumentFragment();
  for (const run of runs) {
    const pieces = content.slice(run.start, run.end).split("\n");
    pieces.forEach((piece, index) => {
      if (piece.length > 0) {
        const span = root.ownerDocument.createElement("span");
        span.textContent = piece;
        applyTextRunDomStyle(span, run.style);
        fragment.appendChild(span);
      }
      if (index < pieces.length - 1) {
        fragment.appendChild(root.ownerDocument.createElement("br"));
      }
    });
  }
  root.replaceChildren(fragment);
}

const TEXT_EDIT_TYPING_STYLE_ATTRIBUTE = "data-opendesign-typing-style";

function installTextEditTypingStyleMarker(
  root: HTMLDivElement,
  offset: number,
  style: TextRunStyle,
  restoreSelection: boolean,
): void {
  const selection = { start: offset, end: offset };
  finalizeTextEditTypingStyleMarkers(root, selection, false);
  const marker = root.ownerDocument.createElement("span");
  marker.setAttribute(TEXT_EDIT_TYPING_STYLE_ATTRIBUTE, "true");
  marker.textContent = "\u200B";
  applyTextRunDomStyle(marker, style);
  const point = textEditDomPoint(root, offset);
  if (point.node.nodeType === Node.TEXT_NODE) {
    const text = point.node as Text;
    const parent = text.parentNode;
    if (!parent) return;
    if (point.offset === 0) {
      parent.insertBefore(marker, text);
    } else if (point.offset === (text.textContent?.length ?? 0)) {
      parent.insertBefore(marker, text.nextSibling);
    } else {
      parent.insertBefore(marker, text.splitText(point.offset));
    }
  } else {
    point.node.insertBefore(
      marker,
      point.node.childNodes[point.offset] ?? null,
    );
  }
  if (restoreSelection) {
    const range = root.ownerDocument.createRange();
    const text = marker.firstChild;
    if (!text) return;
    range.setStart(text, 1);
    range.collapse(true);
    const domSelection = root.ownerDocument.getSelection();
    domSelection?.removeAllRanges();
    domSelection?.addRange(range);
  }
}

function finalizeTextEditTypingStyleMarkers(
  root: HTMLDivElement,
  selection: { start: number; end: number },
  restoreSelection: boolean,
): void {
  const markers = [
    ...root.querySelectorAll<HTMLSpanElement>(
      `[${TEXT_EDIT_TYPING_STYLE_ATTRIBUTE}]`,
    ),
  ];
  if (markers.length === 0) return;
  for (const marker of markers) {
    for (const text of textEditDomTextNodes(marker)) {
      text.textContent = (text.textContent ?? "").replaceAll("\u200B", "");
    }
    marker.removeAttribute(TEXT_EDIT_TYPING_STYLE_ATTRIBUTE);
    if (textEditDomText(marker).length === 0) marker.remove();
  }
  if (restoreSelection) setTextEditDomSelection(root, selection);
}

function applyTextEditCharacterStylesInPlace(
  root: HTMLDivElement,
  selection: { start: number; end: number },
  runs: readonly { end: number; start: number; style: TextRunStyle }[],
  restoreSelection: boolean,
): void {
  const boundaries = new Set([selection.start, selection.end]);
  for (const run of runs) {
    if (run.start > selection.start && run.start < selection.end) {
      boundaries.add(run.start);
    }
    if (run.end > selection.start && run.end < selection.end) {
      boundaries.add(run.end);
    }
  }
  [...boundaries]
    .sort((left, right) => left - right)
    .forEach((offset) => splitTextEditDomAtOffset(root, offset));

  for (const text of textEditDomTextNodes(root)) {
    const start = textDomOffset(root, text, 0);
    const length = text.textContent?.length ?? 0;
    if (
      start === null ||
      length === 0 ||
      start < selection.start ||
      start + length > selection.end
    ) {
      continue;
    }
    const style = runs.find(
      (run) => run.start <= start && start < run.end,
    )?.style;
    if (!style) continue;
    const parent = text.parentElement;
    if (
      parent instanceof HTMLSpanElement &&
      parent.childNodes.length === 1 &&
      !parent.hasAttribute(TEXT_EDIT_TYPING_STYLE_ATTRIBUTE)
    ) {
      applyTextRunDomStyle(parent, style);
    } else {
      const span = root.ownerDocument.createElement("span");
      applyTextRunDomStyle(span, style);
      text.replaceWith(span);
      span.appendChild(text);
    }
  }
  if (restoreSelection) setTextEditDomSelection(root, selection);
}

function splitTextEditDomAtOffset(root: HTMLDivElement, offset: number): void {
  const point = textEditDomPoint(root, offset);
  if (point.node.nodeType !== Node.TEXT_NODE) return;
  const text = point.node as Text;
  const length = text.textContent?.length ?? 0;
  if (point.offset > 0 && point.offset < length) text.splitText(point.offset);
}

function textEditDomTextNodes(root: Node): Text[] {
  const result: Text[] = [];
  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      result.push(node as Text);
      return;
    }
    node.childNodes.forEach(visit);
  };
  visit(root);
  return result;
}

function shouldRestoreTextEditDomSelection(root: HTMLDivElement): boolean {
  const active = root.ownerDocument.activeElement;
  return (
    active === null ||
    active === root.ownerDocument.body ||
    active === root.ownerDocument.documentElement ||
    active === root ||
    root.contains(active)
  );
}

function applyTextRunDomStyle(
  element: HTMLSpanElement,
  style: TextRunStyle,
): void {
  element.style.fontFamily = style.fontFamily;
  element.style.fontSize = `${style.fontSize}px`;
  element.style.fontStyle = style.fontSlant;
  element.style.fontWeight = String(style.fontWeight);
  element.style.letterSpacing = `${style.letterSpacing}px`;
  element.style.lineHeight = `${style.lineHeight}px`;
  element.style.textDecorationLine =
    style.textDecoration === "strikethrough"
      ? "line-through"
      : style.textDecoration;
  element.style.textTransform =
    style.textCase === "title-case"
      ? "capitalize"
      : style.textCase === "small-caps" || style.textCase === "original"
        ? "none"
        : style.textCase;
  element.style.fontVariantCaps =
    style.textCase === "small-caps" ? "small-caps" : "normal";
  const fill = style.fills.find((paint) => paint.type === "solid");
  element.style.color = fill?.color ?? "";
  element.style.opacity = fill ? String(fill.opacity) : "";
}

function setTextEditDomSelection(
  root: HTMLDivElement,
  selection: { start: number; end: number },
): void {
  const start = textEditDomPoint(root, selection.start);
  const end = textEditDomPoint(root, selection.end);
  const range = root.ownerDocument.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  const domSelection = root.ownerDocument.getSelection();
  domSelection?.removeAllRanges();
  domSelection?.addRange(range);
}

function textEditDomPoint(
  root: HTMLDivElement,
  requestedOffset: number,
): { node: Node; offset: number } {
  let remaining = requestedOffset;
  let result: { node: Node; offset: number } | null = null;
  const visit = (node: Node): void => {
    if (result) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const length = node.textContent?.length ?? 0;
      if (remaining <= length) result = { node, offset: remaining };
      else remaining -= length;
      return;
    }
    if (node instanceof HTMLBRElement) {
      const parent = node.parentNode;
      if (!parent) return;
      const index = [...parent.childNodes].indexOf(node);
      if (remaining === 0) result = { node: parent, offset: index };
      else if (remaining === 1) {
        result = { node: parent, offset: index + 1 };
      } else remaining -= 1;
      return;
    }
    node.childNodes.forEach(visit);
  };
  visit(root);
  return result ?? { node: root, offset: root.childNodes.length };
}

function textEditingListCommand(
  event: KeyboardEvent,
): TextEditingListCommand | null {
  const commandModifier = (event.metaKey || event.ctrlKey) && !event.altKey;
  if (commandModifier && event.shiftKey && event.code === "Digit7") {
    return "toggle-ordered";
  }
  if (commandModifier && event.shiftKey && event.code === "Digit8") {
    return "toggle-unordered";
  }
  if (commandModifier && !event.shiftKey && event.code === "BracketRight") {
    return "indent";
  }
  if (commandModifier && !event.shiftKey && event.code === "BracketLeft") {
    return "outdent";
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  if (event.code === "Tab") return event.shiftKey ? "outdent" : "indent";
  if (
    !event.shiftKey &&
    (event.code === "Backspace" || event.code === "Delete")
  ) {
    return "remove-marker";
  }
  if (!event.shiftKey && event.code === "Enter") return "exit-empty-item";
  return null;
}

function stopTextEditKey(event: KeyboardEvent): void {
  event.preventDefault();
  event.stopImmediatePropagation();
}

function isNode(value: unknown): value is Node {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Node).nodeType === "number"
  );
}
