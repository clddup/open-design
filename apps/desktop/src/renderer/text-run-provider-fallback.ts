import type {
  TextRunLayoutProvider,
  TextRunLayoutStyle,
} from "@opendesign/text-service";

export function composeTextRunLayoutProviders<Style extends TextRunLayoutStyle>(
  primary: TextRunLayoutProvider<Style>,
  fallback?: TextRunLayoutProvider<Style>,
): TextRunLayoutProvider<Style> {
  if (!fallback) return primary;
  const id = `${primary.id}+${fallback.id}`;
  const version = `${primary.version}+${fallback.version}`;
  return {
    id,
    version,
    layout(request) {
      const first = primary.layout(request);
      const result =
        first.ok ||
        (first.code !== "unsupported" && first.code !== "provider-unavailable")
          ? first
          : fallback.layout(request);
      return result.ok
        ? { ...result, provider: id, providerVersion: version }
        : result;
    },
  };
}
