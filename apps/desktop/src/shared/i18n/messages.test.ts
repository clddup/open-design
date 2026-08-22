import { describe, expect, it } from "vitest";
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
});
