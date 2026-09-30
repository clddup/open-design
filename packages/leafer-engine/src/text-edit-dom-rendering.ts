import type { TextRunStyle } from "@opendesign/design-contracts";

export function writeTextEditDom(root: HTMLDivElement, content: string): void {
  const fragment = root.ownerDocument.createDocumentFragment();
  content.split("\n").forEach((line, index, lines) => {
    if (index > 0) fragment.appendChild(root.ownerDocument.createElement("br"));
    if (line.length > 0 || lines.length === 1) {
      fragment.appendChild(root.ownerDocument.createTextNode(line));
    }
  });
  replaceTextEditDomFlow(root, fragment);
}

export function writeStyledTextEditDom(
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
  replaceTextEditDomFlow(root, fragment);
}

export function applyTextRunDomStyle(
  element: HTMLSpanElement,
  style: TextRunStyle,
): void {
  element.style.fontFamily = style.fontFamily;
  element.style.fontSize = scaledTextLength(style.fontSize);
  element.style.fontStyle = style.fontSlant;
  element.style.fontWeight = String(style.fontWeight);
  element.style.letterSpacing = scaledTextLength(style.letterSpacing);
  element.style.lineHeight = scaledTextLength(style.lineHeight);
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

export function observeTextEditDomScale(
  root: HTMLDivElement,
  baseFontSize: number,
): MutationObserver {
  // Native TextEditor normalizes its transform and scales root font metrics.
  // Runs must use that same scale, including updates after OPEN and viewport changes.
  const synchronize = () => {
    const scale = Number.parseFloat(root.style.fontSize) / baseFontSize;
    if (!Number.isFinite(scale) || scale <= 0) return;
    const value = String(scale);
    if (root.style.getPropertyValue("--opendesign-text-scale") !== value) {
      root.style.setProperty("--opendesign-text-scale", value);
    }
  };
  const observer = new MutationObserver(synchronize);
  observer.observe(root, { attributes: true, attributeFilter: ["style"] });
  synchronize();
  return observer;
}

function scaledTextLength(value: number): string {
  return `calc(${value}px * var(--opendesign-text-scale, 1))`;
}

function replaceTextEditDomFlow(
  root: HTMLDivElement,
  fragment: DocumentFragment,
): void {
  // Leafer uses a column flex root for vertical alignment. Keep all styled
  // spans and authored breaks in one inline formatting context, not flex rows.
  const flow = root.ownerDocument.createElement("div");
  flow.style.display = "block";
  flow.style.whiteSpace = "inherit";
  flow.style.setProperty("white-space-collapse", "preserve");
  flow.appendChild(fragment);
  root.replaceChildren(flow);
}
