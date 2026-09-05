import { OpenDesignPiRuntime } from "@opendesign/agent-runtime/pi-migration";
import {
  AGENT_PROTOCOL_VERSION,
  isAgentRequest,
  type AgentEvent,
} from "@opendesign/agent-contracts";
import { MockModelGateway } from "@opendesign/model-gateway";
import { dispatchAgentRequest } from "./request-handler.js";
import { ParentModelGateway } from "./parent-model-gateway.js";
import { ParentDesignToolExecutor } from "./parent-design-tool-executor.js";
import { DESIGN_AGENT_TOOL_SPECS } from "@/shared/design-agent-tools.js";
import {
  designThinkingLevelForRequest,
  OPENDESIGN_AGENT_SYSTEM_PROMPT,
} from "./system-prompt.js";
import { DESIGN_VISUAL_COMPLETION_GUARD } from "./design-completion-guard.js";
import { UserApprovalController } from "./user-approval-controller.js";
import { ParentSessionStore } from "./parent-session-store.js";

if (!process.parentPort) {
  throw new Error("OpenDesign Agent must run as an Electron utility process");
}
const port = process.parentPort;

const parentModelGateway = new ParentModelGateway(port);
const parentDesignToolExecutor = new ParentDesignToolExecutor(port);
const parentSessionStore = new ParentSessionStore(port);
const userApprovalController = new UserApprovalController();
const runtime = new OpenDesignPiRuntime({
  modelGateway:
    process.env.OPENDESIGN_AGENT_SMOKE === "1"
      ? new MockModelGateway(
          "I have inspected the current design and prepared a structured edit plan.",
        )
      : parentModelGateway,
  sessionStore: parentSessionStore,
  toolCatalog: {
    listTools: () =>
      DESIGN_AGENT_TOOL_SPECS.map((tool) => ({
        ...tool,
        inputSchema: tool.inputSchema as unknown as Record<string, unknown>,
      })),
  },
  toolExecutor: parentDesignToolExecutor,
  approvalPort: userApprovalController,
  completionGuard: DESIGN_VISUAL_COMPLETION_GUARD,
  systemPrompt: OPENDESIGN_AGENT_SYSTEM_PROMPT,
  thinkingLevelForRequest: designThinkingLevelForRequest,
});

port.on("message", (event) => {
  const request: unknown = event.data;
  if (parentModelGateway.handleMessage(request)) return;
  if (parentDesignToolExecutor.handleMessage(request)) return;
  if (parentSessionStore.handleMessage(request)) return;
  if (!isAgentRequest(request)) {
    console.error("Rejected invalid Agent request");
    return;
  }
  void dispatchAgentRequest(request, {
    runtime,
    postMessage: (message) => port.postMessage(message),
    resolveApproval: (approval) => userApprovalController.resolve(approval),
  });
});

port.postMessage({
  type: "agent.ready",
  protocolVersion: AGENT_PROTOCOL_VERSION,
  runtimeVersion: "0.0.0",
} satisfies AgentEvent);
