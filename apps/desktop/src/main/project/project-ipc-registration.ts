import type { IpcMainInvokeEvent } from "electron";
import { channels } from "@/shared/desktop-api.js";
import type { ProjectIpcService } from "./project-ipc.js";

type ProjectIpcHandler = (
  event: IpcMainInvokeEvent,
  ...args: unknown[]
) => unknown;

export interface ProjectIpcRegistrar {
  handle(channel: string, listener: ProjectIpcHandler): void;
}

export function registerProjectIpc(options: {
  assertRenderer(event: IpcMainInvokeEvent): void;
  getService(): ProjectIpcService;
  ipc: ProjectIpcRegistrar;
}): void {
  const request = (
    channel: string,
    invoke: (service: ProjectIpcService, value: unknown) => unknown,
  ) => {
    options.ipc.handle(channel, (event, ...args) => {
      options.assertRenderer(event);
      assertArgumentCount(args, 1);
      return invoke(options.getService(), args[0]);
    });
  };
  const query = (
    channel: string,
    invoke: (service: ProjectIpcService) => unknown,
  ) => {
    options.ipc.handle(channel, (event, ...args) => {
      options.assertRenderer(event);
      assertArgumentCount(args, 0);
      return invoke(options.getService());
    });
  };

  request(channels.createProject, (service, value) =>
    service.createProject(value),
  );
  query(channels.openProject, (service) => service.openProject());
  request(channels.openRecentProject, (service, value) =>
    service.openRecentProject(value),
  );
  query(channels.listRecentProjects, (service) => service.listRecentProjects());
  request(channels.removeRecentProject, (service, value) =>
    service.removeRecentProject(value),
  );
  request(channels.revealRecentProject, (service, value) =>
    service.revealRecentProject(value),
  );
  query(channels.listOpenProjects, (service) => service.listOpenProjects());
  request(channels.createConversation, (service, value) =>
    service.createConversation(value),
  );
  request(channels.deleteConversation, (service, value) =>
    service.deleteConversation(value),
  );
  request(channels.resolveConversationOpenContext, (service, value) =>
    service.resolveConversationOpenContext(value),
  );
  query(channels.listConversations, (service) => service.listConversations());
  query(channels.listGlobalTasks, (service) => service.listGlobalTasks());
  request(channels.createProjectDesignFile, (service, value) =>
    service.createDesignFile(value),
  );
  request(channels.readProjectDesignFile, (service, value) =>
    service.readDesignFile(value),
  );
  request(channels.saveProjectDesignFile, (service, value) =>
    service.saveDesignFile(value),
  );
  request(channels.renameProjectDesignFile, (service, value) =>
    service.renameDesignFile(value),
  );
  request(channels.publishProjectLibrary, (service, value) =>
    service.publishProjectLibrary(value),
  );
  request(channels.listProjectLibraries, (service, value) =>
    service.listProjectLibraries(value),
  );
  request(channels.readProjectLibraryRelease, (service, value) =>
    service.readProjectLibraryRelease(value),
  );
  request(channels.setProjectLibraryEnabled, (service, value) =>
    service.setProjectLibraryEnabled(value),
  );
  request(channels.setProjectLibraryUpdateIgnored, (service, value) =>
    service.setProjectLibraryUpdateIgnored(value),
  );
  request(channels.setProjectLibraryUpdateAccepted, (service, value) =>
    service.setProjectLibraryUpdateAccepted(value),
  );
}

function assertArgumentCount(args: unknown[], count: number): void {
  if (args.length !== count) throw new TypeError("Unexpected IPC arguments");
}
