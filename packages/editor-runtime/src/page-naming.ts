export function defaultPageName(pageNumber: number): string {
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 1) {
    throw new RangeError("Page number must be a positive safe integer");
  }
  return `Page ${pageNumber}`;
}
