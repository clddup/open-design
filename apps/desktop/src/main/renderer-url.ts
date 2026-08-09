export function resolveRendererUrl(
  environment: Readonly<Record<string, string | undefined>>,
): string | null {
  const url =
    environment.VITE_DEV_SERVER_URL ?? environment.ELECTRON_RENDERER_URL;
  if (!url) return null;
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Unsupported renderer protocol");
  }
  return parsed.toString();
}
