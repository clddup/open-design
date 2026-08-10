import {
  createWelcomeDocument,
  type SvgImportOperationPlan,
} from "@opendesign/editor-runtime";
import type { DesignNode } from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import {
  captureSvgImportTarget,
  normalizeSvgExportRoots,
  planHumanSvgImport,
  runSvgExportInWorker,
  runSvgImportInWorker,
  suggestSvgExportName,
  type SvgInterchangeWorkerError,
  type SvgWorkerLike,
} from "./svg-interchange.js";
import {
  SVG_WORKER_PROTOCOL_VERSION,
  type SuccessfulSvgImportResult,
  type SvgWorkerRequest,
  type SvgWorkerResponse,
} from "./svg-interchange-contract.js";

class FakeWorker implements SvgWorkerLike {
  onerror: SvgWorkerLike["onerror"] = null;
  onmessage: SvgWorkerLike["onmessage"] = null;
  request: SvgWorkerRequest | undefined;
  terminated = false;

  postMessage(message: SvgWorkerRequest): void {
    this.request = message;
  }

  terminate(): void {
    this.terminated = true;
  }

  respond(response: unknown): void {
    this.onmessage?.({ data: response } as MessageEvent<unknown>);
  }
}

function importedResult(): SuccessfulSvgImportResult {
  const root: DesignNode = {
    id: "svg_test_root",
    kind: "group",
    name: "Imported mark",
    parentId: null,
    childIds: ["svg_test_rect"],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 0, 0],
    size: { width: 120, height: 80 },
    opacity: 1,
    properties: {},
    extensions: {},
  };
  const rectangle: DesignNode = {
    id: "svg_test_rect",
    kind: "rectangle",
    name: "Panel",
    parentId: root.id,
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 0, 0],
    size: { width: 120, height: 80 },
    opacity: 1,
    properties: {
      cornerRadius: 0,
      fills: [{ type: "solid", color: "#6d5dfc", opacity: 1 }],
      strokes: [],
      strokeWidth: 0,
    },
    extensions: {},
  };
  return {
    ok: true,
    version: 1,
    rootNodeId: root.id,
    nodes: [root, rectangle],
    sourceViewport: { x: 0, y: 0, width: 120, height: 80 },
    issues: [],
  };
}

function completedImport(request: SvgWorkerRequest): SvgWorkerResponse {
  return {
    protocolVersion: SVG_WORKER_PROTOCOL_VERSION,
    requestId: request.requestId,
    operation: "import",
    type: "completed",
    result: importedResult(),
  };
}

describe("SVG worker runner", () => {
  it("projects a bounded import request and terminates after a valid response", async () => {
    const worker = new FakeWorker();
    const result = runSvgImportInWorker(
      { svg: "<svg />", idPrefix: "svg_test", name: "Test" },
      undefined,
      { requestId: "request_import", workerFactory: () => worker },
    );
    expect(worker.request).toMatchObject({
      operation: "import",
      requestId: "request_import",
      svg: "<svg />",
    });
    if (!worker.request) throw new Error("SVG request was not posted");

    worker.respond(completedImport(worker.request));

    await expect(result).resolves.toMatchObject({
      rootNodeId: "svg_test_root",
    });
    expect(worker.terminated).toBe(true);
  });

  it("returns structured worker failures and fidelity issues", async () => {
    const worker = new FakeWorker();
    const result = runSvgImportInWorker(
      { svg: "<svg />", idPrefix: "svg_test", name: "Test" },
      undefined,
      { requestId: "request_failure", workerFactory: () => worker },
    );
    worker.respond({
      protocolVersion: SVG_WORKER_PROTOCOL_VERSION,
      requestId: "request_failure",
      operation: "import",
      type: "failed",
      code: "unsupported-element",
      message: "SVG contains unsupported content",
      issues: [
        {
          code: "unsupported-element",
          message: "filter is unavailable",
          severity: "error",
        },
      ],
    });

    await expect(result).rejects.toMatchObject({
      code: "unsupported-element",
      issues: [expect.objectContaining({ code: "unsupported-element" })],
    } satisfies Partial<SvgInterchangeWorkerError>);
    expect(worker.terminated).toBe(true);
  });

  it("terminates the worker on cancellation and rejects stale responses", async () => {
    const worker = new FakeWorker();
    const controller = new AbortController();
    const result = runSvgExportInWorker(
      {
        document: createWelcomeDocument(),
        pageId: "page_welcome",
        rootNodeIds: ["frame_welcome"],
        settings: { includeLayerIds: false, padding: 0 },
      },
      controller.signal,
      { requestId: "request_export", workerFactory: () => worker },
    );
    controller.abort();

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.terminated).toBe(true);

    const invalidWorker = new FakeWorker();
    const invalid = runSvgImportInWorker(
      { svg: "<svg />", idPrefix: "svg_test", name: "Test" },
      undefined,
      { requestId: "request_expected", workerFactory: () => invalidWorker },
    );
    invalidWorker.respond({
      ...completedImport({
        ...(invalidWorker.request ?? {}),
        requestId: "request_other",
      } as SvgWorkerRequest),
      requestId: "request_other",
    });
    await expect(invalid).rejects.toMatchObject({ code: "protocol-error" });
    expect(invalidWorker.terminated).toBe(true);
  });
});

describe("human SVG import placement", () => {
  const viewport = {
    zoom: 1,
    panX: 0,
    panY: 0,
    width: 800,
    height: 600,
  };

  it("centers into one explicitly selected Frame and appends at top paint order", () => {
    const document = createWelcomeDocument();
    const frame = document.nodesById.frame_welcome;
    if (!frame || frame.kind !== "frame") throw new Error("Frame is missing");
    const target = captureSvgImportTarget(
      document,
      "page_welcome",
      [frame.id],
      viewport,
    );
    const plan = planHumanSvgImport(
      document,
      importedResult(),
      target,
      "svg_import",
    );

    expect(target).toMatchObject({
      parentId: frame.id,
      index: frame.childIds.length,
      center: { x: frame.size.width / 2, y: frame.size.height / 2 },
    });
    expect(plan).toMatchObject({ ok: true, rootNodeId: "svg_test_root" });
    expect(rootCommand(plan)).toMatchObject({
      parentId: frame.id,
      index: frame.childIds.length,
      node: {
        transform: [
          1,
          0,
          0,
          1,
          frame.size.width / 2 - 60,
          frame.size.height / 2 - 40,
        ],
      },
    });
  });

  it("uses the Page root and viewport center for non-container selections", () => {
    const document = createWelcomeDocument();
    const target = captureSvgImportTarget(
      document,
      "page_welcome",
      ["title_welcome"],
      viewport,
    );
    const plan = planHumanSvgImport(
      document,
      importedResult(),
      target,
      "svg_import",
    );

    expect(target).toMatchObject({
      parentId: null,
      center: { x: 400, y: 300 },
    });
    expect(rootCommand(plan)).toMatchObject({
      parentId: null,
      node: { transform: [1, 0, 0, 1, 340, 260] },
    });
  });

  it("refuses to retarget an import after the document revision changes", () => {
    const document = createWelcomeDocument();
    const target = captureSvgImportTarget(
      document,
      "page_welcome",
      [],
      viewport,
    );
    const changed = structuredClone(document);
    changed.revision += 1;

    expect(
      planHumanSvgImport(changed, importedResult(), target, "svg_import"),
    ).toMatchObject({ ok: false, code: "invalid-target" });
  });
});

describe("human SVG export targets", () => {
  it("removes descendants already covered by an explicitly selected ancestor", () => {
    const document = createWelcomeDocument();
    const frame = document.nodesById.frame_welcome;
    if (!frame) throw new Error("Frame is missing");
    const childId = frame.childIds[0];
    if (!childId) throw new Error("Frame child is missing");

    expect(normalizeSvgExportRoots(document, [frame.id, childId])).toEqual([
      frame.id,
    ]);
  });

  it("creates portable file names for a layer or multi-selection", () => {
    const document = structuredClone(createWelcomeDocument());
    const frame = document.nodesById.frame_welcome;
    if (!frame) throw new Error("Frame is missing");
    frame.name = "CON:/Brand*Mark";

    expect(suggestSvgExportName(document, "page_welcome", [frame.id])).toBe(
      "CON--Brand-Mark.svg",
    );
    expect(
      suggestSvgExportName(document, "page_welcome", [
        frame.id,
        frame.childIds[0] ?? "",
      ]),
    ).toBe("Welcome selection.svg");
  });
});

function rootCommand(plan: SvgImportOperationPlan) {
  if (!plan.ok) throw new Error(plan.message);
  return plan.commands.find(
    (command) =>
      command.type === "insert_element" && command.node.id === plan.rootNodeId,
  );
}
