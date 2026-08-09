import { AgentRuntime } from "@opendesign/agent-runtime";
import {
  AGENT_PROTOCOL_VERSION,
  isAgentRequest,
  type AgentEvent,
} from "@opendesign/agent-contracts";
import { MockModelGateway } from "@opendesign/model-gateway";
import { JsonlSessionStore } from "@opendesign/session-store";
import { join } from "node:path";
import { homedir } from "node:os";
import { dispatchAgentRequest } from "./request-handler.js";
import { ParentModelGateway } from "./parent-model-gateway.js";
import { ParentDesignToolExecutor } from "./parent-design-tool-executor.js";
import {
  DESIGN_AGENT_TOOL_SPECS,
  validateDesignAgentToolInput,
} from "../shared/design-agent-tools.js";
import { OPENDESIGN_AGENT_SYSTEM_PROMPT } from "./system-prompt.js";

if (!process.parentPort) {
  throw new Error("OpenDesign Agent must run as an Electron utility process");
}
const port = process.parentPort;

const parentModelGateway = new ParentModelGateway(port);
const parentDesignToolExecutor = new ParentDesignToolExecutor(port);
const runtime = new AgentRuntime({
  modelGateway:
    process.env.OPENDESIGN_AGENT_SMOKE === "1"
      ? new MockModelGateway(
          "I have inspected the current design and prepared a structured edit plan.",
        )
      : parentModelGateway,
  sessionStore: new JsonlSessionStore(
    join(homedir(), ".opendesign", "sessions", "events.jsonl"),
  ),
  toolCatalog: {
    listTools: () =>
      DESIGN_AGENT_TOOL_SPECS.map((tool) => ({
        ...tool,
        inputSchema: tool.inputSchema as unknown as Record<string, unknown>,
        validateInput: (input: unknown) =>
          validateDesignAgentToolInput(tool.name, input),
      })),
  },
  toolExecutor: parentDesignToolExecutor,
  systemPrompt: OPENDESIGN_AGENT_SYSTEM_PROMPT,
});

port.on("message", (event) => {
  const request: unknown = event.data;
  if (parentModelGateway.handleMessage(request)) return;
  if (parentDesignToolExecutor.handleMessage(request)) return;
  if (!isAgentRequest(request)) {
    console.error("Rejected invalid Agent request");
    return;
  }
  void dispatchAgentRequest(request, {
    runtime,
    postMessage: (message) => port.postMessage(message),
  });
});

port.postMessage({
  type: "agent.ready",
  protocolVersion: AGENT_PROTOCOL_VERSION,
  runtimeVersion: "0.0.0",
} satisfies AgentEvent);
