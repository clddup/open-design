import { describe, expect, it } from "vitest";
import {
  isTextLayoutQualityEvidence,
  TEXT_LAYOUT_QUALITY_EVIDENCE_VERSION,
} from "./text-quality-evidence.js";

describe("text layout quality evidence", () => {
  it("accepts exact-revision measured and unavailable observations", () => {
    expect(
      isTextLayoutQualityEvidence({
        version: TEXT_LAYOUT_QUALITY_EVIDENCE_VERSION,
        documentId: "document_1",
        revision: 7,
        pageId: "page_1",
        measurements: [
          {
            status: "measured",
            nodeId: "copy",
            provider: "leafer-text",
            providerVersion: "2.2.9",
            boxSize: { width: 120, height: 40 },
            fullContentSize: { width: 120, height: 72 },
            displayedContentSize: { width: 120, height: 40 },
            overflow: { horizontal: false, vertical: true },
            truncated: true,
          },
          {
            status: "unavailable",
            nodeId: "rich-copy",
            message: "Provider unavailable",
          },
        ],
      }),
    ).toBe(true);
  });

  it("rejects duplicate nodes, extra keys and invalid dimensions", () => {
    const measurement = {
      status: "unavailable",
      nodeId: "copy",
      message: "Provider unavailable",
    } as const;
    expect(
      isTextLayoutQualityEvidence({
        version: 1,
        documentId: "document_1",
        revision: 7,
        pageId: "page_1",
        measurements: [measurement, measurement],
      }),
    ).toBe(false);
    expect(
      isTextLayoutQualityEvidence({
        version: 1,
        documentId: "document_1",
        revision: 7,
        pageId: "page_1",
        measurements: [
          {
            status: "measured",
            nodeId: "copy",
            provider: "leafer-text",
            providerVersion: "2.2.9",
            boxSize: { width: -1, height: 40 },
            fullContentSize: { width: 120, height: 72 },
            displayedContentSize: { width: 120, height: 40 },
            overflow: { horizontal: false, vertical: true },
            truncated: true,
          },
        ],
      }),
    ).toBe(false);
  });
});
