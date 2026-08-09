export function isAllowedRendererNavigation(
  candidateUrl: string,
  developmentRendererUrl: string | null,
  packagedRendererUrl: string,
): boolean {
  const candidate = parseUrl(candidateUrl);
  if (!candidate) return false;

  if (developmentRendererUrl) {
    const development = parseUrl(developmentRendererUrl);
    return Boolean(
      development &&
      ["http:", "https:"].includes(candidate.protocol) &&
      candidate.origin === development.origin,
    );
  }

  const packaged = parseUrl(packagedRendererUrl);
  return Boolean(
    packaged &&
    candidate.protocol === "file:" &&
    candidate.pathname === packaged.pathname,
  );
}

export function isExternalHttpUrl(value: string): boolean {
  const url = parseUrl(value);
  return Boolean(url && ["http:", "https:"].includes(url.protocol));
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}
