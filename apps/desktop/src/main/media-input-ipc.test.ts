import type { AgentAttachment } from "@opendesign/agent-contracts";
import type { DesignAsset } from "@opendesign/design-contracts";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { describe, expect, it, vi } from "vitest";
import { channels, type DesignImageEditRequest } from "@/shared/desktop-api.js";
import {
  MediaInputIpcHost,
  type DesignImageEditOutput,
  type MediaInputIpcHostOptions,
  type MediaInputIpcRegistrar,
} from "./media-input-ipc.js";

type Handler = Parameters<MediaInputIpcRegistrar["handle"]>[1];
const event = {} as IpcMainInvokeEvent;
const imageDigest = "a".repeat(64);
const imageAttachment: AgentAttachment = {
  attachmentId: `image_${imageDigest}`,
  name: "Hero.webp",
  mimeType: "image/webp",
  byteSize: 5,
};
const fileAttachment: AgentAttachment = {
  attachmentId: `file_${"b".repeat(64)}`,
  name: "Brief.txt",
  mimeType: "text/plain",
  byteSize: 5,
};
const sourceAsset: DesignAsset = {
  id: `asset_${imageDigest}`,
  kind: "image",
  name: "Hero.webp",
  mimeType: "image/webp",
  source: { type: "data", value: "aW1hZ2U=" },
  size: { width: 1600, height: 900 },
  extensions: { importedBy: "design-image-picker" },
};
const referenceAsset: DesignAsset = {
  ...sourceAsset,
  id: `asset_${"c".repeat(64)}`,
  name: "Reference.png",
  mimeType: "image/png",
};
const resultAsset: DesignAsset = {
  ...sourceAsset,
  id: `asset_${"d".repeat(64)}`,
  name: "Hero — Edited.png",
  mimeType: "image/png",
};
const editOutput: DesignImageEditOutput = {
  asset: resultAsset,
  derivation: {
    id: "image_derivation_edit",
    sourceAssetId: sourceAsset.id,
    resultAssetId: resultAsset.id,
    operation: "prompt-edit",
    prompt: "Edit image",
    referenceAssetIds: [],
    extensions: { provider: "openai-images", modelId: "image-model" },
  },
};

describe("MediaInputIpcHost", () => {
  it("owns attachment and design-image native selection", async () => {
    const fixture = setup();

    await expect(
      invoke(fixture, channels.selectAgentAttachments),
    ).resolves.toEqual([imageAttachment]);
    await expect(invoke(fixture, channels.selectDesignImage)).resolves.toEqual({
      asset: {
        id: `asset_${imageDigest}`,
        kind: "image",
        name: "Hero.webp",
        mimeType: "image/webp",
        source: { type: "data", value: "aW1hZ2U=" },
        size: { width: 1600, height: 900 },
        extensions: { importedBy: "design-image-picker" },
      },
    });
    expect(fixture.openDialog).toHaveBeenCalledTimes(2);
    expect(fixture.openDialog.mock.calls[0]?.[1]).toMatchObject({
      properties: ["openFile", "multiSelections"],
    });
    expect(fixture.openDialog.mock.calls[1]?.[1]).toMatchObject({
      properties: ["openFile"],
      filters: [
        expect.objectContaining({
          extensions: ["png", "jpg", "jpeg", "webp", "gif"],
        }),
      ],
    });
    expect(fixture.decodeImageSize).toHaveBeenCalledOnce();
    expect(fixture.handlers.size).toBe(6);
  });

  it("imports bounded Renderer bytes and returns attachment previews", async () => {
    const fixture = setup();
    const imported = [{ name: "Brief.txt", bytes: new Uint8Array([1, 2, 3]) }];

    await expect(
      invoke(fixture, channels.importAgentAttachments, imported),
    ).resolves.toEqual([fileAttachment]);
    await expect(
      invoke(fixture, channels.getAgentAttachmentPreview, {
        attachmentId: fileAttachment.attachmentId,
      }),
    ).resolves.toEqual({
      attachmentId: fileAttachment.attachmentId,
      previewDataUrl: null,
    });
    expect(fixture.attachmentHost.importBytes).toHaveBeenCalledWith(
      "Brief.txt",
      imported[0]?.bytes,
    );

    const sharedBytes = new Uint8Array(12 * 1024 * 1024);
    await expect(
      invoke(fixture, channels.importAgentAttachments, [
        { name: "a.bin", bytes: sharedBytes },
        { name: "b.bin", bytes: sharedBytes },
        { name: "c.bin", bytes: sharedBytes },
      ]),
    ).rejects.toThrow("Attachments exceed the 32 MB total limit");
  });

  it("normalizes every inspector image-edit action for the trusted editor", async () => {
    const fixture = setup();
    const requests: DesignImageEditRequest[] = [
      request({ action: "remove-background" }),
      request({ action: "upscale" }),
      request({
        action: "replace-background",
        prompt: "Warm editorial studio",
      }),
      request({ action: "relight", lightingPreset: "neon" }),
      request({
        action: "prompt-edit",
        prompt: "Use the reference lighting",
        reference: referenceAsset,
      }),
      request({
        action: "erase-object",
        selection: areaSelection(),
      }),
      request({
        action: "isolate-object",
        selection: areaSelection(),
      }),
      request({
        action: "expand",
        expansion: { top: 20, right: 100, bottom: 20, left: 0 },
        placement: { mode: "fill", focalPoint: { x: 0.5, y: 0.5 } },
        targetSize: { width: 400, height: 300 },
      }),
    ];

    for (const candidate of requests) {
      await expect(
        invoke(fixture, channels.editDesignImage, candidate),
      ).resolves.toMatchObject({
        requestId: candidate.requestId,
        action: candidate.action,
        sourceAssetId: sourceAsset.id,
      });
    }

    const normalized = fixture.editImage.mock.calls.map(([input]) => input);
    expect(normalized).toEqual([
      expect.objectContaining({
        action: "remove-background",
        importedBy: "inspector-image-edit",
      }),
      expect.objectContaining({ action: "upscale" }),
      expect.objectContaining({
        action: "replace-background",
        prompt: "Warm editorial studio",
      }),
      expect.objectContaining({ action: "relight", lightingPreset: "neon" }),
      expect.objectContaining({
        action: "prompt-edit",
        references: [referenceAsset],
      }),
      expect.objectContaining({
        action: "erase-object",
        selection: areaSelection(),
      }),
      expect.objectContaining({
        action: "isolate-object",
        selection: areaSelection(),
      }),
      expect.objectContaining({
        action: "expand",
        targetSize: { width: 400, height: 300 },
      }),
    ]);
  });

  it("deduplicates, cancels and clears active image edits", async () => {
    let finish!: (result: DesignImageEditOutput) => void;
    const pending = new Promise<DesignImageEditOutput>((resolve) => {
      finish = resolve;
    });
    const fixture = setup({ editImage: vi.fn(() => pending) });
    const candidate = request({ action: "remove-background" });
    const editing = invoke(fixture, channels.editDesignImage, candidate);
    await vi.waitFor(() => expect(fixture.editImage).toHaveBeenCalledOnce());
    const signal = fixture.editImage.mock.calls[0]?.[1];

    await expect(
      invoke(fixture, channels.editDesignImage, candidate),
    ).rejects.toThrow(`Image edit ${candidate.requestId} is already running`);
    expect(
      invoke(fixture, channels.cancelDesignImageEdit, {
        requestId: candidate.requestId,
      }),
    ).toBe(true);
    expect(signal?.aborted).toBe(true);
    expect(signal?.reason).toMatchObject({
      name: "AbortError",
      message: "Image editing cancelled",
    });
    const second = invoke(
      fixture,
      channels.editDesignImage,
      request({ action: "upscale", requestId: "image_edit_second" }),
    );
    await vi.waitFor(() => expect(fixture.editImage).toHaveBeenCalledTimes(2));
    const secondSignal = fixture.editImage.mock.calls[1]?.[1];
    fixture.host.abortAll("OpenDesign is shutting down");
    expect(secondSignal?.reason).toMatchObject({
      name: "AbortError",
      message: "OpenDesign is shutting down",
    });
    finish(editOutput);
    await Promise.all([editing, second]);
    expect(
      invoke(fixture, channels.cancelDesignImageEdit, {
        requestId: candidate.requestId,
      }),
    ).toBe(false);
  });

  it("validates sender before arguments, payloads and side effects", async () => {
    const fixture = setup({
      assertRenderer: vi.fn(() => {
        throw new Error("Request from unknown renderer");
      }),
    });

    await expect(
      invoke(fixture, channels.importAgentAttachments, [{ invalid: true }]),
    ).rejects.toThrow("Request from unknown renderer");
    expect(fixture.openDialog).not.toHaveBeenCalled();
    expect(fixture.attachmentHost.importBytes).not.toHaveBeenCalled();

    fixture.assertRenderer.mockImplementation(() => undefined);
    await expect(
      invoke(fixture, channels.selectDesignImage, "extra"),
    ).rejects.toThrow("Unexpected IPC arguments");
    await expect(
      invoke(fixture, channels.editDesignImage, { requestId: "bad" }),
    ).rejects.toThrow("Invalid design image edit request");
  });
});

function areaSelection() {
  return {
    points: [
      { x: 0.2, y: 0.2 },
      { x: 0.8, y: 0.2 },
      { x: 0.8, y: 0.8 },
      { x: 0.2, y: 0.8 },
    ],
  };
}

function request(
  action: WithoutBase<DesignImageEditRequest>,
): DesignImageEditRequest {
  return {
    requestId: "image_edit_request",
    pageId: "page_welcome",
    nodeId: "hero",
    expectedAssetId: sourceAsset.id,
    source: sourceAsset,
    ...action,
  };
}

type BaseEditRequest = {
  requestId: string;
  pageId: string;
  nodeId: string;
  expectedAssetId: string;
  source: DesignAsset;
};

type WithoutBase<Request> = Request extends unknown
  ? Omit<Request, keyof BaseEditRequest> & Partial<BaseEditRequest>
  : never;

function invoke(
  fixture: ReturnType<typeof setup>,
  channel: string,
  ...args: unknown[]
): unknown {
  const handler = fixture.handlers.get(channel);
  if (!handler) throw new Error(`Missing handler ${channel}`);
  return handler(event, ...args);
}

function setup(
  overrides: {
    assertRenderer?: (event: IpcMainInvokeEvent) => void;
    editImage?: MediaInputIpcHostOptions["editImage"];
  } = {},
) {
  const handlers = new Map<string, Handler>();
  const attachmentHost = {
    importBytes: vi.fn(() => Promise.resolve(fileAttachment)),
    importFiles: vi.fn(() => Promise.resolve([imageAttachment])),
    preview: vi.fn(() => Promise.resolve(null)),
    resolve: vi.fn(() =>
      Promise.resolve({
        kind: "image" as const,
        data: "aW1hZ2U=",
        mimeType: "image/webp" as const,
        byteSize: 5,
      }),
    ),
  };
  const window = {} as BrowserWindow;
  const openDialog = vi.fn<MediaInputIpcHostOptions["openDialog"]>(() =>
    Promise.resolve({ canceled: false, filePaths: ["/tmp/hero.webp"] }),
  );
  const decodeImageSize = vi.fn(() => ({ width: 1600, height: 900 }));
  const editImage = vi.fn(
    overrides.editImage ?? (() => Promise.resolve(editOutput)),
  );
  const assertRenderer = vi.fn(overrides.assertRenderer ?? (() => undefined));
  const options: MediaInputIpcHostOptions = {
    decodeImageSize,
    editImage,
    getAttachmentHost: () => attachmentHost,
    getLocale: () => "zh-CN",
    getWindow: () => window,
    openDialog,
  };
  const host = new MediaInputIpcHost(options);
  host.registerIpc({
    assertRenderer,
    ipc: {
      handle(channel, listener) {
        handlers.set(channel, listener);
      },
    },
  });
  return {
    assertRenderer,
    attachmentHost,
    decodeImageSize,
    editImage,
    handlers,
    host,
    openDialog,
  };
}
