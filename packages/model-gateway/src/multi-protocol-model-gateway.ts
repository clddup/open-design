import type {
  Api,
  Context,
  Model,
  SimpleStreamOptions,
  ThinkingLevel,
} from "@earendil-works/pi-ai";
import { streamSimple as streamAnthropicMessages } from "@earendil-works/pi-ai/api/anthropic-messages";
import { streamSimple as streamOpenAICompletions } from "@earendil-works/pi-ai/api/openai-completions";
import { streamSimple as streamOpenAIResponses } from "@earendil-works/pi-ai/api/openai-responses";
import type { CanonicalStreamEvent } from "./canonical-wire.js";
import type {
  ModelGateway,
  ModelRequest,
  ProviderModelConfiguration,
} from "./model-gateway-ports.js";
import { toPiContext, toPiModel } from "./pi-context-projection.js";
import { mapPiEvent, modelError } from "./pi-stream-projection.js";
import type {
  ModelAuthMode,
  ResolvedModelIdentity,
} from "./provider-config.js";
import { exposesReasoningSummary } from "./reasoning-visibility.js";

/**
 * Main-hosted multi-protocol adapter backed by Pi's typed API registry.
 * The caller resolves a provider profile and credential before construction;
 * neither value is exposed to Renderer or the Agent utility process.
 */
export class MultiProtocolModelGateway implements ModelGateway {
  readonly #configuration: ProviderModelConfiguration;
  readonly #fetch: typeof globalThis.fetch;

  constructor(configuration: ProviderModelConfiguration) {
    this.#configuration = configuration;
    this.#fetch = configuration.fetch ?? globalThis.fetch;
  }

  async *stream(request: ModelRequest): AsyncIterable<CanonicalStreamEvent> {
    const { providerId, modelId, reasoningEffort } = request.modelSelection;
    if (
      providerId !== this.#configuration.providerId ||
      modelId !== this.#configuration.model.modelId
    ) {
      throw new Error("Resolved model configuration does not match selection");
    }

    const identity: ResolvedModelIdentity = {
      providerId,
      modelId,
      apiFormat: this.#configuration.apiFormat,
      ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    };
    yield {
      type: "attempt.started",
      attemptId: request.attemptId,
      model: modelId,
      identity,
    };

    try {
      const model = toPiModel(this.#configuration);
      const stream = streamConfiguredModel(
        model,
        toPiContext(request, identity),
        this.streamOptions(request),
      );
      for await (const event of stream) {
        if (!exposesReasoningSummary(this.#configuration.apiFormat, event))
          continue;
        for (const canonical of mapPiEvent(event, request.attemptId)) {
          yield canonical;
        }
      }
    } catch (error) {
      yield {
        type: "attempt.failed",
        attemptId: request.attemptId,
        error: modelError(error, providerId, request.signal.aborted),
      };
    }
  }

  private streamOptions(request: ModelRequest): SimpleStreamOptions {
    const effort = request.modelSelection.reasoningEffort;
    return {
      apiKey: this.#configuration.credential ?? "opendesign-no-auth",
      fetch: authenticatedFetch(
        this.#fetch,
        this.#configuration.authMode,
        this.#configuration.credential,
      ),
      signal: request.signal,
      ...(request.sessionId === undefined
        ? {}
        : { sessionId: request.sessionId }),
      ...(effort === undefined || effort === "off"
        ? {}
        : { reasoning: effort satisfies ThinkingLevel }),
    };
  }
}

function streamConfiguredModel(
  model: Model<Api>,
  context: Context,
  options: SimpleStreamOptions,
) {
  if (model.api === "openai-responses") {
    return streamOpenAIResponses(
      model as Model<"openai-responses">,
      context,
      options,
    );
  }
  if (model.api === "openai-completions") {
    return streamOpenAICompletions(
      model as Model<"openai-completions">,
      context,
      options,
    );
  }
  if (model.api === "anthropic-messages") {
    return streamAnthropicMessages(
      model as Model<"anthropic-messages">,
      context,
      options,
    );
  }
  throw new Error(`Unsupported model API: ${model.api}`);
}

function authenticatedFetch(
  fetchImplementation: typeof globalThis.fetch,
  authMode: ModelAuthMode,
  credential: string | undefined,
): typeof globalThis.fetch {
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    headers.delete("authorization");
    headers.delete("x-api-key");
    if (credential && authMode === "bearer") {
      headers.set("authorization", `Bearer ${credential}`);
    }
    if (credential && authMode === "x-api-key") {
      headers.set("x-api-key", credential);
    }
    return fetchImplementation(input, { ...init, headers });
  };
}
