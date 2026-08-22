type MessageCatalog = Readonly<Record<string, string>>;

type UnionToIntersection<Value> = (
  Value extends unknown ? (value: Value) => void : never
) extends (value: infer Intersection) => void
  ? Intersection
  : never;

type MergedCatalog<Catalogs extends readonly MessageCatalog[]> =
  UnionToIntersection<Catalogs[number]>;

export function mergeCatalogs<const Catalogs extends readonly MessageCatalog[]>(
  ...catalogs: Catalogs
): MergedCatalog<Catalogs> {
  const merged: Record<string, string> = {};
  for (const catalog of catalogs) {
    for (const [key, message] of Object.entries(catalog)) {
      if (Object.hasOwn(merged, key)) {
        throw new Error(`Duplicate i18n message key: ${key}`);
      }
      merged[key] = message;
    }
  }
  return merged as MergedCatalog<Catalogs>;
}
