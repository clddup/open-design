import type { ModelApiFormat, ModelAuthMode } from "./provider-config.js";
import type {
  CanonicalMessage,
  CanonicalStreamEvent,
  SerializableModelRequest,
} from "./canonical-wire.js";

export interface ModelRequest extends Omit<
  SerializableModelRequest,
  "messages"
> {
  messages: CanonicalMessage[];
  signal: AbortSignal;
}

export interface ModelGateway {
  stream(request: ModelRequest): AsyncIterable<CanonicalStreamEvent>;
}

export interface CredentialHost {
  withCredential<T>(
    provider: string,
    operation: (credential: string) => Promise<T>,
  ): Promise<T>;
}

export interface ProviderModelConfiguration {
  providerId: string;
  apiFormat: ModelApiFormat;
  authMode: ModelAuthMode;
  baseUrl: string;
  credential?: string;
  model: {
    modelId: string;
    name: string;
    contextWindow: number;
    maxOutputTokens: number;
    reasoning: boolean;
    imageInput: boolean;
  };
  fetch?: typeof globalThis.fetch;
}
