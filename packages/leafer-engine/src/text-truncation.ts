type LeaferTextRow = {
  data?: Array<{ char?: string }> | null;
  paraEnd?: boolean;
  text?: string;
};

type LeaferTextInstance = {
  readonly boxBounds: unknown;
  readonly __?: { __textDrawData?: { rows?: LeaferTextRow[] } };
  destroy(): void;
};

export type LeaferTextModule = {
  Text: new (data?: Record<string, unknown>) => LeaferTextInstance;
};

export function materializeLeaferTextData(
  leafer: LeaferTextModule,
  data: Record<string, unknown>,
  maxLines: number | undefined,
): Record<string, unknown> {
  if (maxLines === undefined || typeof data.text !== "string") return data;
  const displayText = truncateLeaferText(leafer, data, data.text, maxLines);
  return displayText === data.text ? data : { ...data, text: displayText };
}

export function truncateLeaferText(
  leafer: LeaferTextModule,
  data: Record<string, unknown>,
  content: string,
  maxLines: number,
): string {
  const rows = measureRows(leafer, data, content);
  if (!rows || rows.length <= maxLines) return content;

  const visibleRows = rows.slice(0, maxLines);
  let visiblePrefix = "";
  for (let index = 0; index < visibleRows.length; index += 1) {
    const row = visibleRows[index]!;
    visiblePrefix += rowText(row);
    if (row.paraEnd && index < visibleRows.length - 1) visiblePrefix += "\n";
  }
  visiblePrefix = visiblePrefix.trimEnd();
  if (!visiblePrefix) visiblePrefix = Array.from(content)[0] ?? "";

  const characters = Array.from(visiblePrefix);
  let lower = 0;
  let upper = characters.length;
  while (lower < upper) {
    const middle = Math.ceil((lower + upper) / 2);
    const candidate = withEllipsis(characters.slice(0, middle).join(""));
    const candidateRows = measureRows(leafer, data, candidate);
    if (candidateRows && candidateRows.length <= maxLines) lower = middle;
    else upper = middle - 1;
  }
  return withEllipsis(characters.slice(0, lower).join(""));
}

function measureRows(
  leafer: LeaferTextModule,
  data: Record<string, unknown>,
  content: string,
): LeaferTextRow[] | null {
  const measurement: Record<string, unknown> = {
    ...data,
    text: content,
    textOverflow: "show",
  };
  delete measurement.height;
  let text: LeaferTextInstance | undefined;
  try {
    text = new leafer.Text(measurement);
    void text.boxBounds;
    const rows = text.__?.__textDrawData?.rows;
    return Array.isArray(rows) ? rows.map((row) => ({ ...row })) : null;
  } finally {
    text?.destroy();
  }
}

function rowText(row: LeaferTextRow): string {
  if (typeof row.text === "string") return row.text;
  if (!Array.isArray(row.data)) return "";
  return row.data.map((character) => character.char ?? "").join("");
}

function withEllipsis(value: string): string {
  const prefix = value.trimEnd();
  return `${prefix || value}...`;
}
