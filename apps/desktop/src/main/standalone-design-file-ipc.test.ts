import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import { channels } from "@/shared/desktop-api.js";
import {
  resolveDesignFileSavePath,
  StandaloneDesignFileIpcHost,
  type StandaloneDesignFileIpcHostOptions,
  type StandaloneDesignFileIpcRegistrar,
  suggestDesignFileName,
} from "./standalone-design-file-ipc.js";

type Handler = Parameters<StandaloneDesignFileIpcRegistrar["handle"]>[1];
const event = {} as IpcMainInvokeEvent;
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("StandaloneDesignFileIpcHost", () => {
  it("opens, tracks and atomically saves one standalone document", async () => {
    const directory = await temporaryDirectory();
    const filePath = join(directory, "Opened.opendesign");
    await writeFile(filePath, '{"revision":1}', "utf8");
    const fixture = setup({
      openDialog: vi.fn(() =>
        Promise.resolve({ canceled: false, filePaths: [filePath] }),
      ),
    });

    await expect(invoke(fixture, channels.openDesignFile)).resolves.toEqual({
      name: "Opened.opendesign",
      contents: '{"revision":1}',
    });
    expect(fixture.openDialog.mock.calls[0]?.[1]).toMatchObject({
      properties: ["openFile"],
      filters: [{ extensions: ["opendesign"] }],
    });

    await expect(
      invoke(fixture, channels.saveDesignFile, {
        suggestedName: "Ignored.opendesign",
        contents: '{"revision":2}',
      }),
    ).resolves.toEqual({ name: "Opened.opendesign" });
    expect(fixture.saveDialog).not.toHaveBeenCalled();
    await expect(readFile(filePath, "utf8")).resolves.toBe('{"revision":2}');
    expect(await temporaryArtifacts(directory)).toEqual([]);

    fixture.host.clear();
    await expect(
      invoke(fixture, channels.saveDesignFile, {
        suggestedName: "New.opendesign",
        contents: '{"revision":3}',
      }),
    ).resolves.toBeNull();
    expect(fixture.saveDialog).toHaveBeenCalledOnce();
  });

  it("adds the canonical suffix on Save As and reuses only a successful path", async () => {
    const directory = await temporaryDirectory();
    const selectedPath = join(directory, "Brand");
    const saveDialog = vi
      .fn<StandaloneDesignFileIpcHostOptions["saveDialog"]>()
      .mockResolvedValueOnce({ canceled: false, filePath: selectedPath })
      .mockResolvedValueOnce({ canceled: true, filePath: "" });
    const fixture = setup({ saveDialog });

    await expect(
      invoke(fixture, channels.saveDesignFile, {
        suggestedName: "Brand.OPENDESIGN",
        contents: '{"revision":1}',
        saveAs: true,
      }),
    ).resolves.toEqual({ name: "Brand.opendesign" });
    expect(saveDialog.mock.calls[0]?.[1]).toMatchObject({
      defaultPath: "Brand.OPENDESIGN",
      filters: [{ extensions: ["opendesign"] }],
    });
    const savedPath = `${selectedPath}.opendesign`;
    await expect(readFile(savedPath, "utf8")).resolves.toBe('{"revision":1}');

    await expect(
      invoke(fixture, channels.saveDesignFile, {
        suggestedName: "Unused.opendesign",
        contents: '{"revision":2}',
      }),
    ).resolves.toEqual({ name: "Brand.opendesign" });
    expect(saveDialog).toHaveBeenCalledOnce();
    await expect(readFile(savedPath, "utf8")).resolves.toBe('{"revision":2}');

    await expect(
      invoke(fixture, channels.saveDesignFile, {
        suggestedName: "Cancelled.opendesign",
        contents: '{"revision":3}',
        saveAs: true,
      }),
    ).resolves.toBeNull();
    expect(saveDialog).toHaveBeenCalledTimes(2);
    await expect(readFile(savedPath, "utf8")).resolves.toBe('{"revision":2}');
    expect(await temporaryArtifacts(directory)).toEqual([]);
  });

  it("does not promote invalid, non-file or oversized native selections", async () => {
    const directory = await temporaryDirectory();
    const invalidUtf8 = join(directory, "Invalid.opendesign");
    const oversized = join(directory, "Oversized.opendesign");
    const directoryPath = join(directory, "Folder.opendesign");
    await writeFile(invalidUtf8, new Uint8Array([0xff]));
    await writeFile(oversized, "x");
    await truncate(oversized, 64 * 1024 * 1024 + 1);
    await mkdir(directoryPath);

    const openDialog = vi
      .fn<StandaloneDesignFileIpcHostOptions["openDialog"]>()
      .mockResolvedValueOnce({ canceled: false, filePaths: [invalidUtf8] })
      .mockResolvedValueOnce({ canceled: false, filePaths: [oversized] })
      .mockResolvedValueOnce({ canceled: false, filePaths: [directoryPath] });
    const fixture = setup({ openDialog });

    await expect(invoke(fixture, channels.openDesignFile)).rejects.toThrow(
      "must contain valid UTF-8",
    );
    await expect(invoke(fixture, channels.openDesignFile)).rejects.toThrow(
      "exceeds the 64 MB limit",
    );
    await expect(invoke(fixture, channels.openDesignFile)).rejects.toThrow(
      "must be a regular file",
    );
    await expect(
      invoke(fixture, channels.saveDesignFile, {
        suggestedName: "Fresh.opendesign",
        contents: '{"revision":1}',
      }),
    ).resolves.toBeNull();
    expect(fixture.saveDialog).toHaveBeenCalledOnce();
  });

  it("validates sender, argument count and payload before side effects", async () => {
    const fixture = setup({
      assertRenderer: vi.fn(() => {
        throw new Error("Request from unknown renderer");
      }),
    });

    expect(() => invoke(fixture, channels.openDesignFile, "extra")).toThrow(
      "Request from unknown renderer",
    );
    expect(fixture.openDialog).not.toHaveBeenCalled();

    fixture.assertRenderer.mockImplementation(() => undefined);
    expect(() => invoke(fixture, channels.openDesignFile, "extra")).toThrow(
      "Unexpected IPC arguments",
    );
    await expect(
      invoke(fixture, channels.saveDesignFile, {
        suggestedName: "Board.opendesign",
        contents: "{}",
        filePath: "/tmp/forged.opendesign",
      }),
    ).rejects.toThrow("Invalid OpenDesign save request");
    expect(() =>
      invoke(
        fixture,
        channels.saveDesignFile,
        { suggestedName: "Board.opendesign", contents: "{}" },
        "extra",
      ),
    ).toThrow("Unexpected IPC arguments");
    expect(fixture.saveDialog).not.toHaveBeenCalled();
  });
});

describe("standalone Design File path normalization", () => {
  it("uses native Windows path semantics without exposing paths to Renderer", () => {
    expect(resolveDesignFileSavePath("C:\\Design\\Board", win32)).toBe(
      "C:\\Design\\Board.opendesign",
    );
    expect(
      resolveDesignFileSavePath("C:\\Design\\Board.OPENDESIGN", win32),
    ).toBe("C:\\Design\\Board.OPENDESIGN");
    expect(() =>
      resolveDesignFileSavePath("C:\\Design\\Board.json", win32),
    ).toThrow("must use the .opendesign extension");
    expect(() => resolveDesignFileSavePath("Board", win32)).toThrow(
      "must be an absolute path",
    );
  });

  it("normalizes portable suggested names case-insensitively", () => {
    expect(suggestDesignFileName("Board")).toBe("Board.opendesign");
    expect(suggestDesignFileName("Board.OPENDESIGN")).toBe("Board.OPENDESIGN");
  });
});

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
    openDialog?: StandaloneDesignFileIpcHostOptions["openDialog"];
    saveDialog?: StandaloneDesignFileIpcHostOptions["saveDialog"];
  } = {},
) {
  const handlers = new Map<string, Handler>();
  const window = {} as BrowserWindow;
  const openDialog = vi.fn(
    overrides.openDialog ??
      (() => Promise.resolve({ canceled: true, filePaths: [] })),
  );
  const saveDialog = vi.fn(
    overrides.saveDialog ??
      (() => Promise.resolve({ canceled: true, filePath: "" })),
  );
  const assertRenderer = vi.fn(overrides.assertRenderer ?? (() => undefined));
  const host = new StandaloneDesignFileIpcHost({
    getLocale: () => "zh-CN",
    getWindow: () => window,
    openDialog,
    saveDialog,
  });
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
    handlers,
    host,
    openDialog,
    saveDialog,
  };
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "opendesign-document-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function temporaryArtifacts(directory: string): Promise<string[]> {
  return (await readdir(directory)).filter((name) =>
    name.startsWith(".opendesign-document-"),
  );
}
