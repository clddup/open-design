import type { IpcMainInvokeEvent } from "electron";
import { channels, type ModelProviderCatalog } from "@/shared/desktop-api.js";
import {
  DeleteModelProviderProfileRequestContract,
  SaveGlobalImageGenerationSettingsRequestContract,
  SaveModelProviderProfileRequestContract,
  SaveVisualCriticSelectionRequestContract,
  TestModelProviderConnectionRequestContract,
} from "@/shared/provider-config-contract.js";
import { formatValidationFailure } from "@/shared/contract-validation.js";
import type { ImageGenerationHost } from "./image-generation-host.js";
import type { ModelProviderHost } from "./model-provider-host.js";

type ModelProviderIpcHost = Pick<
  ModelProviderHost,
  | "deleteProfile"
  | "getCatalog"
  | "saveProfile"
  | "saveVisualCriticSelection"
  | "testConnection"
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
      const parsed = SaveGlobalImageGenerationSettingsRequestContract.parse(
        args[0],
      );
      if (!parsed.ok) {
        throw new TypeError(
          formatValidationFailure(
            "global image-generation settings request",
            parsed.issues,
          ),
        );
      }
      return options.getImageGenerationHost().saveSettings(parsed.value);
    },
  );
  options.ipc.handle(
    channels.saveModelProviderProfile,
    (event, ...args: unknown[]) => {
      options.assertRenderer(event);
      assertArgumentCount(args, 1);
      const parsed = SaveModelProviderProfileRequestContract.parse(args[0]);
      if (!parsed.ok) {
        throw new TypeError(
          formatValidationFailure("model Provider save request", parsed.issues),
        );
      }
      const catalog = options.getModelProviderHost().saveProfile(parsed.value);
      options.publishModelProviderCatalog(catalog);
      return catalog;
    },
  );
  options.ipc.handle(
    channels.saveVisualCriticSelection,
    (event, ...args: unknown[]) => {
      options.assertRenderer(event);
      assertArgumentCount(args, 1);
      const parsed = SaveVisualCriticSelectionRequestContract.parse(args[0]);
      if (!parsed.ok) {
        throw new TypeError(
          formatValidationFailure(
            "visual critic model selection request",
            parsed.issues,
          ),
        );
      }
      const catalog = options
        .getModelProviderHost()
        .saveVisualCriticSelection(parsed.value);
      options.publishModelProviderCatalog(catalog);
      return catalog;
    },
  );
  options.ipc.handle(
    channels.deleteModelProviderProfile,
    (event, ...args: unknown[]) => {
      options.assertRenderer(event);
      assertArgumentCount(args, 1);
      const parsed = DeleteModelProviderProfileRequestContract.parse(args[0]);
      if (!parsed.ok) {
        throw new TypeError(
          formatValidationFailure(
            "model Provider delete request",
            parsed.issues,
          ),
        );
      }
      const catalog = options
        .getModelProviderHost()
        .deleteProfile(parsed.value);
      options.publishModelProviderCatalog(catalog);
      return catalog;
    },
  );
  options.ipc.handle(
    channels.testModelProviderConnection,
    (event, ...args: unknown[]) => {
      options.assertRenderer(event);
      assertArgumentCount(args, 1);
      const parsed = TestModelProviderConnectionRequestContract.parse(args[0]);
      if (!parsed.ok) {
        throw new TypeError(
          formatValidationFailure(
            "model Provider connection test request",
            parsed.issues,
          ),
        );
      }
      return options.getModelProviderHost().testConnection(parsed.value);
    },
  );
}

function assertArgumentCount(args: unknown[], count: number): void {
  if (args.length !== count) throw new TypeError("Unexpected IPC arguments");
}
