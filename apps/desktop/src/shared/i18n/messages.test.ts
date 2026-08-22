import { describe, expect, it } from "vitest";
import { enMessages } from "./catalogs/en";
import { mergeCatalogs } from "./catalogs/merge-catalogs";
import { zhCNMessages } from "./catalogs/zh-CN";
import { translate } from "./messages";

describe("i18n catalog registry", () => {
  it("resolves language-specific feature catalogs", () => {
    expect(translate("en", "properties.imageChangeLighting")).toBe(
      "Change lighting…",
    );
    expect(translate("zh-CN", "properties.imageChangeLighting")).toBe(
      "更改光线…",
    );
  });

  it("interpolates parameters after selecting the locale catalog", () => {
    expect(
      translate("zh-CN", "history.renameLayers", {
        count: 3,
      }),
    ).toBe("重命名 3 个图层");
  });

  it("keeps English and Chinese feature key sets exactly aligned", () => {
    expect(Object.keys(zhCNMessages).sort()).toEqual(
      Object.keys(enMessages).sort(),
    );
  });

  it("rejects duplicate feature ownership instead of silently overriding", () => {
    expect(() =>
      mergeCatalogs(
        { "feature.shared": "First owner" },
        { "feature.shared": "Second owner" },
      ),
    ).toThrow("Duplicate i18n message key: feature.shared");
  });
});
