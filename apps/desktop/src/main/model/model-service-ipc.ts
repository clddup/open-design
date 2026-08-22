import type { IpcMainInvokeEvent } from "electron";
import {
  channels,
  isDeleteModelProviderProfileRequest,
  isSaveGlobalImageGenerationSettingsRequest,
  isSaveModelProviderProfileRequest,
  isTestModelProviderConnectionRequest,
  type ModelProviderCatalog,
} from "../../shared/desktop-api.js";
import type { ImageGenerationHost } from "./image-generation-host.js";
import type { ModelProviderHost } from "./model-provider-host.js";

type ModelProviderIpcHost = Pick<
  ModelProviderHost,
  "deleteProfile" | "getCatalog" | "saveProfile" | "testConnection"
>;
type ImageGenerationIpcHost = Pick<
  ImageGenerationHost,
  "getSettings" | "saveSettings"
>;
type ModelServiceIpcHandler = (
  event: IpcMainInvokeEvent,
  ...args: unknown[]
) => unknown;

export interface ModelServiceIpcRegistrar {
  handle(channel: string, listener: ModelServiceIpcHandler): void;
}

export function registerModelServiceIpc(options: {
  assertRenderer(event: IpcMainInvokeEvent): void;
  getImageGenerationHost(): ImageGenerationIpcHost;
  getModelProviderHost(): ModelProviderIpcHost;
  ipc: ModelServiceIpcRegistrar;
  publishModelProviderCatalog(catalog: ModelProviderCatalog): void;
}): void {
  options.ipc.handle(
    channels.getModelProviderCatalog,
    (event, ...args: unknown[]) => {
      options.assertRenderer(event);
      assertArgumentCount(args, 0);
      return options.getModelProviderHost().getCatalog();
    },
  );
  options.ipc.handle(
    channels.getGlobalImageGenerationSettings,
    (event, ...args: unknown[]) => {
      options.assertRenderer(event);
      assertArgumentCount(args, 0);
      return options.getImageGenerationHost().getSettings();
    },
  );
  options.ipc.handle(
    channels.saveGlobalImageGenerationSettings,
    (event, ...args: unknown[]) => {
      options.assertRenderer(event);
      assertArgumentCount(args, 1);
      const request = args[0];
      if (!isSaveGlobalImageGenerationSettingsRequest(request)) {
        throw new TypeError("Invalid global image-generation settings");
      }
      return options.getImageGenerationHost().saveSettings(request);
    },
  );
  options.ipc.handle(
    channels.saveModelProviderProfile,
    (event, ...args: unknown[]) => {
      options.assertRenderer(event);
      assertArgumentCount(args, 1);
      const request = args[0];
      if (!isSaveModelProviderProfileRequest(request)) {
        throw new TypeError("Invalid model provider profile");
      }
      const catalog = options.getModelProviderHost().saveProfile(request);
      options.publishModelProviderCatalog(catalog);
      return catalog;
    },
  );
  options.ipc.handle(
    channels.deleteModelProviderProfile,
    (event, ...args: unknown[]) => {
      options.assertRenderer(event);
      assertArgumentCount(args, 1);
      const request = args[0];
      if (!isDeleteModelProviderProfileRequest(request)) {
        throw new TypeError("Invalid model provider delete request");
      }
      const catalog = options.getModelProviderHost().deleteProfile(request);
      options.publishModelProviderCatalog(catalog);
      return catalog;
    },
  );
  options.ipc.handle(
    channels.testModelProviderConnection,
    (event, ...args: unknown[]) => {
      options.assertRenderer(event);
      assertArgumentCount(args, 1);
      const request = args[0];
      if (!isTestModelProviderConnectionRequest(request)) {
        throw new TypeError("Invalid model provider test request");
      }
      return options.getModelProviderHost().testConnection(request);
    },
  );
}

function assertArgumentCount(args: unknown[], count: number): void {
  if (args.length !== count) throw new TypeError("Unexpected IPC arguments");
}
