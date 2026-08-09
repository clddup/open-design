import { describe, expect, it } from "vitest";
import {
  isAllowedRendererNavigation,
  isExternalHttpUrl,
} from "./navigation-policy.js";

describe("renderer navigation policy", () => {
  it("allows the configured development origin without trusting prefix matches", () => {
    const developmentUrl = "http://127.0.0.1:5173/";
    expect(
      isAllowedRendererNavigation(
        "http://127.0.0.1:5173/editor",
        developmentUrl,
        "file:///Applications/OpenDesign/renderer/index.html",
      ),
    ).toBe(true);
    expect(
      isAllowedRendererNavigation(
        "http://127.0.0.1:51730/editor",
        developmentUrl,
        "file:///Applications/OpenDesign/renderer/index.html",
      ),
    ).toBe(false);
    expect(
      isAllowedRendererNavigation(
        "https://127.0.0.1:5173/editor",
        developmentUrl,
        "file:///Applications/OpenDesign/renderer/index.html",
      ),
    ).toBe(false);
  });

  it("allows only the packaged renderer entry file", () => {
    const packagedUrl = "file:///Applications/OpenDesign/renderer/index.html";
    expect(isAllowedRendererNavigation(packagedUrl, null, packagedUrl)).toBe(
      true,
    );
    expect(
      isAllowedRendererNavigation(
        "file:///Applications/OpenDesign/renderer/other.html",
        null,
        packagedUrl,
      ),
    ).toBe(false);
    expect(
      isAllowedRendererNavigation("file:///etc/passwd", null, packagedUrl),
    ).toBe(false);
  });

  it("recognizes only valid HTTP and HTTPS external URLs", () => {
    expect(isExternalHttpUrl("https://opendesign.dev/docs")).toBe(true);
    expect(isExternalHttpUrl("http://localhost:3000")).toBe(true);
    expect(isExternalHttpUrl("file:///tmp/index.html")).toBe(false);
    expect(isExternalHttpUrl("not a URL")).toBe(false);
  });
});
