import type { AgentAttachment } from "@opendesign/agent-contracts";
import type {
  CanonicalStreamEvent,
  ModelError,
  ModelGateway,
  ModelLatencyProfile,
} from "@opendesign/model-gateway";
import type { Message } from "@earendil-works/pi-ai";

export interface PiModelGatewayAdapterOptions {
  modelGateway: ModelGateway;
  latencyProfile?: ModelLatencyProfile;
  contextProjection?: PiModelContextProjectionPort;
  failurePort?: PiModelFailurePort;
  nextAttemptId?: () => string;
  now?: () => number;
  onRetryEvent?: (
    event: Extract<
      CanonicalStreamEvent,
      { type: "attempt.retrying" | "attempt.recovered" }
    >,
  ) => void;
}

export interface PiModelFailurePort {
  recordFailure(failure: ModelError): void;
  consumeFailure(): ModelError | undefined;
}

export function createPiModelFailurePort(): PiModelFailurePort {
  let latest: ModelError | undefined;
  return {
    recordFailure(failure) {
      latest = structuredClone(failure);
    },
    consumeFailure() {
      const failure = latest;
      latest = undefined;
      return failure === undefined ? undefined : structuredClone(failure);
    },
  };
}

export interface PiContextFailure {
  code: string;
  message: string;
}

export interface PiModelContextProjectionPort {
  beforeProviderTurn(): PiContextFailure | undefined;
  attachmentsFor(message: Message): readonly AgentAttachment[];
}
