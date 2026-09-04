import {
  ModelResponseAccumulator,
  type ModelGateway,
  type ModelRequest,
  type ModelSelection,
} from "@opendesign/model-gateway";
import { Type, type Static } from "@sinclair/typebox";
import type { ProviderConnectionResult } from "@/shared/desktop-api.js";
import { defineContract } from "@/shared/contract-validation.js";

const ConnectionProbeInputSchema = Type.Object(
  {
    nonce: Type.Literal("opendesign-probe-v1"),
    width: Type.Literal(320),
    height: Type.Literal(240),
  },
  { additionalProperties: false },
);

const ConnectionProbeInputContract = defineContract<
  Static<typeof ConnectionProbeInputSchema>
>({
  schema: ConnectionProbeInputSchema,
  code: "provider_config.connection_probe_input_invalid",
  subject: "model Provider connection probe input",
  clone: false,
});

const connectionProbeTool = {
  name: "opendesign_connection_probe",
  description:
    "Verify that this model can emit a structured, parameterized Agent tool call.",
  inputSchema: ConnectionProbeInputSchema,
} satisfies ModelRequest["tools"][number];

type ConnectionOptions = {
  selection: ModelSelection;
  gateway: (selection: ModelSelection) => ModelGateway;
  signal?: AbortSignal;
};

export async function testModelProviderConnection(
  options: ConnectionOptions,
): Promise<ProviderConnectionResult> {
  const startedAt = performance.now();
  const text = await probeTextConnection(options, startedAt);
  if (!text.ok) {
    return connectionResult(
      options.selection,
      "unreachable",
      text.message,
      startedAt,
    );
  }
  const tool = await probeToolConnection(options);
  return connectionResult(
    options.selection,
    tool.status,
    tool.message,
    startedAt,
    text.latencyMs,
    tool.latencyMs,
  );
}

async function probeTextConnection(
  options: ConnectionOptions,
  startedAt: number,
): Promise<{ ok: true; latencyMs: number } | { ok: false; message: string }> {
  try {
    await runConnectionProbe(
      options,
      "connection_text_test",
      "Reply with OK.",
      [{ role: "user", content: "OK" }],
    );
    return { ok: true, latencyMs: elapsed(startedAt) };
  } catch (error) {
    return {
      ok: false,
      message: errorMessage(error, "Provider connection failed"),
    };
  }
}

async function probeToolConnection(options: ConnectionOptions): Promise<{
  status: "compatible" | "text-only";
  message: string;
  latencyMs: number;
}> {
  const toolStartedAt = performance.now();
  try {
    const response = await runConnectionProbe(
      options,
      "connection_tool_test",
      "Call opendesign_connection_probe exactly once with nonce opendesign-probe-v1, width 320, and height 240. Do not answer with text.",
      [
        {
          role: "user",
          content:
            "Run the Agent tool compatibility probe with every required value.",
        },
      ],
      [connectionProbeTool],
    );
    const toolLatencyMs = elapsed(toolStartedAt);
    const call = response.blocks.find(
      (block) =>
        block.type === "tool_call" && block.name === connectionProbeTool.name,
    );
    if (
      response.stopReason !== "tool_use" ||
      call?.type !== "tool_call" ||
      !ConnectionProbeInputContract.parse(call.input).ok
    ) {
      return {
        status: "text-only",
        message:
          "The endpoint returned text but did not produce the required parameterized tool call",
        latencyMs: toolLatencyMs,
      };
    }
    return {
      status: "compatible",
      message: "Provider supports Agent tool calling",
      latencyMs: toolLatencyMs,
    };
  } catch (error) {
    return {
      status: "text-only",
      message: errorMessage(error, "Agent tool compatibility probe failed"),
      latencyMs: elapsed(toolStartedAt),
    };
  }
}

function connectionResult(
  selection: ModelSelection,
  status: ProviderConnectionResult["status"],
  message: string,
  startedAt: number,
  textLatencyMs?: number,
  toolLatencyMs?: number,
): ProviderConnectionResult {
  return {
    status,
    ok: status === "compatible",
    message,
    providerId: selection.providerId,
    modelId: selection.modelId,
    latencyMs: elapsed(startedAt),
    ...(textLatencyMs === undefined ? {} : { textLatencyMs }),
    ...(toolLatencyMs === undefined ? {} : { toolLatencyMs }),
  };
}

async function runConnectionProbe(
  options: ConnectionOptions,
  attemptId: string,
  system: string,
  messages: ModelRequest["messages"],
  tools: ModelRequest["tools"] = [],
) {
  const accumulator = new ModelResponseAccumulator(attemptId);
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 30_000);
  try {
    for await (const event of options.gateway(options.selection).stream({
      attemptId,
      sessionId: "connection_test",
      modelSelection: {
        providerId: options.selection.providerId,
        modelId: options.selection.modelId,
      },
      system,
      messages,
      tools,
      signal: controller.signal,
    })) {
      accumulator.add(event);
    }
    return accumulator.result();
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function elapsed(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}
