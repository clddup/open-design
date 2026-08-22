import type { IpcMainInvokeEvent } from "electron";
import { describe, expect, it, vi } from "vitest";
import { channels } from "../../shared/desktop-api.js";
import type { ProjectIpcService } from "./project-ipc.js";
import {
  registerProjectIpc,
  type ProjectIpcRegistrar,
} from "./project-ipc-registration.js";

type Handler = Parameters<ProjectIpcRegistrar["handle"]>[1];

const requestChannels = [
  [channels.createProject, "createProject"],
  [channels.openRecentProject, "openRecentProject"],
  [channels.removeRecentProject, "removeRecentProject"],
  [channels.revealRecentProject, "revealRecentProject"],
  [channels.createConversation, "createConversation"],
  [channels.deleteConversation, "deleteConversation"],
  [channels.resolveConversationOpenContext, "resolveConversationOpenContext"],
  [channels.createProjectDesignFile, "createDesignFile"],
  [channels.readProjectDesignFile, "readDesignFile"],
  [channels.saveProjectDesignFile, "saveDesignFile"],
  [channels.renameProjectDesignFile, "renameDesignFile"],
  [channels.publishProjectLibrary, "publishProjectLibrary"],
  [channels.listProjectLibraries, "listProjectLibraries"],
  [channels.readProjectLibraryRelease, "readProjectLibraryRelease"],
  [channels.setProjectLibraryEnabled, "setProjectLibraryEnabled"],
  [channels.setProjectLibraryUpdateIgnored, "setProjectLibraryUpdateIgnored"],
  [channels.setProjectLibraryUpdateAccepted, "setProjectLibraryUpdateAccepted"],
] as const;

const queryChannels = [
  [channels.openProject, "openProject"],
  [channels.listRecentProjects, "listRecentProjects"],
  [channels.listOpenProjects, "listOpenProjects"],
  [channels.listConversations, "listConversations"],
  [channels.listGlobalTasks, "listGlobalTasks"],
] as const;

const event = {} as IpcMainInvokeEvent;

describe("registerProjectIpc", () => {
  it("registers every Project, Conversation and Library channel with its service method", async () => {
    const { assertRenderer, handlers, service } = setup();
    const request = { requestId: "request_1" };

    for (const [channel, method] of requestChannels) {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`Missing handler ${channel}`);
      await expect(handler(event, request)).resolves.toEqual(method);
      expect(service[method]).toHaveBeenCalledWith(request);
    }
    for (const [channel, method] of queryChannels) {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`Missing handler ${channel}`);
      await expect(handler(event)).resolves.toEqual(method);
      expect(service[method]).toHaveBeenCalledWith();
    }

    expect(handlers.size).toBe(requestChannels.length + queryChannels.length);
    expect(assertRenderer).toHaveBeenCalledTimes(handlers.size);
  });

  it("validates the sender before arguments and resolves the current service per request", () => {
    const assertRenderer = vi.fn<(event: IpcMainInvokeEvent) => void>(() => {
      throw new Error("Request from unknown renderer");
    });
    const getService = vi.fn(() => {
      throw new Error("Project services are not initialized");
    });
    const { handlers } = setup({ assertRenderer, getService });
    const handler = handlers.get(channels.openProject);
    if (!handler) throw new Error("Open Project handler is missing");

    expect(() => handler(event, "unexpected")).toThrow(
      "Request from unknown renderer",
    );
    expect(getService).not.toHaveBeenCalled();

    assertRenderer.mockImplementation(() => undefined);
    expect(() => handler(event)).toThrow(
      "Project services are not initialized",
    );
    expect(getService).toHaveBeenCalledOnce();
  });

  it("rejects missing and extra arguments without invoking the service", () => {
    const { handlers, service } = setup();
    const query = handlers.get(channels.listRecentProjects);
    const request = handlers.get(channels.createProject);
    if (!query || !request) throw new Error("Project handlers are missing");

    expect(() => query(event, {})).toThrow("Unexpected IPC arguments");
    expect(() => request(event)).toThrow("Unexpected IPC arguments");
    expect(() => request(event, {}, {})).toThrow("Unexpected IPC arguments");
    expect(service.listRecentProjects).not.toHaveBeenCalled();
    expect(service.createProject).not.toHaveBeenCalled();
  });
});

function setup(
  overrides: {
    assertRenderer?: (event: IpcMainInvokeEvent) => void;
    getService?: () => ProjectIpcService;
  } = {},
) {
  const handlers = new Map<string, Handler>();
  const ipc: ProjectIpcRegistrar = {
    handle(channel, handler) {
      handlers.set(channel, handler);
    },
  };
  const service = Object.fromEntries(
    [...requestChannels, ...queryChannels].map(([, method]) => [
      method,
      vi.fn(() => Promise.resolve(method)),
    ]),
  ) as Record<
    (typeof requestChannels)[number][1] | (typeof queryChannels)[number][1],
    ReturnType<typeof vi.fn>
  >;
  const assertRenderer = overrides.assertRenderer ?? vi.fn();
  const getService =
    overrides.getService ?? (() => service as unknown as ProjectIpcService);
  registerProjectIpc({ assertRenderer, getService, ipc });
  return { assertRenderer, getService, handlers, service };
}
