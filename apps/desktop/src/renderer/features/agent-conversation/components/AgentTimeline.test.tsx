import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  AgentAttachment,
  AgentEvent,
  SessionTimelineItem,
} from "@opendesign/agent-contracts";
import { describe, expect, it, vi } from "vitest";
import type { DesktopApi } from "@/shared/desktop-api";
import { AgentTimeline } from "./AgentTimeline";

const now = "2026-08-08T12:00:00.000Z";

async function chooseNextOption(
  user: ReturnType<typeof userEvent.setup>,
  selectName: string,
) {
  screen.getByRole("combobox", { name: selectName }).focus();
  await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("AgentTimeline", () => {
  it("shows the current executable Plan as a real collapsible checklist", () => {
    const timeline: SessionTimelineItem[] = [
      {
        itemId: "tool:first_slice_plan",
        sessionId: "conversation_1",
        runId: "run_1",
        sequence: 1,
        createdAt: now,
        updatedAt: now,
        type: "tool",
        toolCallId: "first_slice_plan",
        toolName: "opendesign_generate_first_slice",
        input: {},
        risk: "design_write",
        status: "completed",
        result: {
          planRevision: 1,
          plan: {
            targets: [
              {
                targetId: "target_home",
                label: "Home",
                objective: "Establish the primary product hierarchy",
                implementationSteps: [
                  "Build navigation and hero",
                  "Add primary content and status",
                ],
              },
            ],
          },
          delivery: {
            version: 3,
            targets: [
              {
                targetId: "target_home",
                label: "Home",
                pageId: "page_1",
                rootNodeId: "frame_home",
                reservedNodeIds: ["frame_home"],
                status: "drafted",
                allocatedRevision: 1,
                draftRevision: 2,
              },
            ],
            activeTargetId: "target_home",
          },
          deliveryStage: {
            totalTargets: 12,
            plannedTargets: 1,
            verifiedTargets: 0,
            currentPlan: { stage: 1, status: "active" },
          },
        },
        revision: 2,
        transactionId: "transaction_first_slice",
      },
    ];

    render(
      <AgentTimeline
        activeRunId="run_1"
        conversationId="conversation_1"
        conversationTitle="Product suite"
        error={null}
        events={[]}
        onStop={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(true)}
        timeline={timeline}
      />,
    );

    expect(screen.getByText("Current plan · Stage 1/12")).toBeInTheDocument();
    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByText("Build navigation and hero")).toBeInTheDocument();
    expect(
      document.querySelector("details[data-agent-plan]")?.hasAttribute("open"),
    ).toBe(true);
  });

  it("shows a trustworthy milestone without inferred delivery counts", () => {
    const timeline: SessionTimelineItem[] = [
      {
        itemId: "tool:capture_home",
        sessionId: "conversation_1",
        runId: "run_1",
        sequence: 1,
        createdAt: now,
        updatedAt: now,
        type: "tool",
        toolCallId: "capture_home",
        toolName: "opendesign_capture_canvas",
        input: {},
        risk: "read",
        status: "completed",
        result: {
          delivery: {
            version: 3,
            targets: [
              {
                targetId: "target_home",
                label: "Home",
                pageId: "page_1",
                rootNodeId: "frame_home",
                reservedNodeIds: ["frame_home"],
                status: "verified",
                allocatedRevision: 1,
                draftRevision: 1,
                captureRevision: 1,
                reviewRevision: 1,
                refinementRevision: 2,
                verifiedRevision: 2,
              },
              {
                targetId: "target_profile",
                label: "Profile",
                pageId: "page_1",
                rootNodeId: "frame_profile",
                reservedNodeIds: ["frame_profile"],
                status: "pending",
              },
            ],
            activeTargetId: "target_profile",
          },
        },
      },
    ];

    render(
      <AgentTimeline
        activeRunId="run_1"
        conversationId="conversation_1"
        conversationTitle="Product suite"
        error={null}
        events={[]}
        onStop={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(true)}
        timeline={timeline}
      />,
    );

    expect(
      screen.getByText("First editable design is visible"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/real artboards/)).not.toBeInTheDocument();
    expect(screen.queryByText(/targets complete/)).not.toBeInTheDocument();
    expect(screen.queryByText(/1\/2/)).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("describes a saved page without exposing internal completion fractions", () => {
    const timeline: SessionTimelineItem[] = [
      {
        itemId: "run:run_1",
        sessionId: "conversation_1",
        runId: "run_1",
        sequence: 1,
        createdAt: now,
        updatedAt: now,
        type: "run",
        status: "error",
        startedAt: now,
        finishedAt: now,
        stopReason: "error",
      },
      {
        itemId: "tool:capture_register",
        sessionId: "conversation_1",
        runId: "run_1",
        sequence: 2,
        createdAt: now,
        updatedAt: now,
        type: "tool",
        toolCallId: "capture_register",
        toolName: "opendesign_capture_canvas",
        input: {},
        risk: "read",
        status: "completed",
        revision: 8,
        transactionId: "transaction_register",
        result: {
          delivery: {
            version: 3,
            targets: [
              {
                targetId: "login",
                label: "Login",
                pageId: "page_1",
                rootNodeId: "frame_login",
                reservedNodeIds: ["frame_login"],
                status: "verified",
                allocatedRevision: 1,
                draftRevision: 2,
                captureRevision: 3,
                reviewRevision: 4,
                refinementRevision: 5,
                verifiedRevision: 6,
              },
              {
                targetId: "register",
                label: "Register",
                pageId: "page_1",
                rootNodeId: "frame_register",
                reservedNodeIds: ["frame_register"],
                status: "captured",
                allocatedRevision: 1,
                draftRevision: 7,
                captureRevision: 8,
              },
            ],
            activeTargetId: "register",
          },
        },
      },
    ];

    render(
      <AgentTimeline
        activeRunId={null}
        conversationId="conversation_1"
        conversationTitle="Product suite"
        error="Provider request timed out"
        events={[]}
        onStop={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(true)}
        timeline={timeline}
      />,
    );

    expect(
      screen.getByText("Page saved; later checks incomplete"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/\d+\/\d+/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/usable work preserved/i),
    ).not.toBeInTheDocument();
  });

  it("does not present a previous Run delivery ledger as current progress", () => {
    const timeline: SessionTimelineItem[] = [
      {
        itemId: "tool:prior_delivery",
        sessionId: "conversation_1",
        runId: "run_previous",
        sequence: 1,
        createdAt: now,
        updatedAt: now,
        type: "tool",
        toolCallId: "prior_delivery",
        toolName: "opendesign_capture_canvas",
        input: {},
        risk: "read",
        status: "completed",
        result: {
          delivery: {
            version: 3,
            targets: [
              {
                targetId: "target_previous",
                label: "Previous",
                pageId: "page_1",
                rootNodeId: "frame_previous",
                reservedNodeIds: ["frame_previous"],
                status: "verified",
                allocatedRevision: 1,
                draftRevision: 1,
                captureRevision: 1,
                reviewRevision: 1,
                refinementRevision: 2,
                verifiedRevision: 2,
              },
            ],
            activeTargetId: null,
          },
        },
      },
    ];

    render(
      <AgentTimeline
        activeRunId="run_current"
        conversationId="conversation_1"
        conversationTitle="Current request"
        error={null}
        events={[]}
        onStop={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(true)}
        timeline={timeline}
      />,
    );

    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByText("1/1 verified")).not.toBeInTheDocument();
  });

  it("lets an editor without a Conversation create one in place", async () => {
    const user = userEvent.setup();
    const onCreateConversation = vi.fn().mockResolvedValue(true);

    render(
      <AgentTimeline
        activeRunId={null}
        conversationId={null}
        conversationTitle={null}
        error={null}
        events={[]}
        onCreateConversation={onCreateConversation}
        onStop={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(true)}
        timeline={[]}
      />,
    );

    expect(
      screen.getByRole("combobox", { name: "Conversation" }),
    ).toHaveTextContent("No Conversations yet");
    await user.click(screen.getByRole("button", { name: "New Conversation" }));
    expect(onCreateConversation).toHaveBeenCalledOnce();
  });

  it("uses the first canvas prompt to start a Conversation without reserving a side column", async () => {
    const user = userEvent.setup();
    const onStartConversation = vi.fn().mockResolvedValue(true);
    window.desktop = {
      getModelProviderCatalog: vi.fn().mockResolvedValue({
        version: 3,
        providers: [
          {
            providerId: "provider_1",
            name: "Primary",
            enabled: true,
            apiFormat: "openai-responses",
            authMode: "bearer",
            baseUrl: "https://api.openai.com/v1",
            models: [
              {
                modelId: "design-model",
                name: "Design model",
                contextWindow: 200_000,
                maxOutputTokens: 16_384,
                capabilities: {
                  toolUse: true,
                  imageInput: false,
                  reasoning: true,
                },
                reasoningEfforts: ["off", "medium"],
              },
            ],
            hasApiKey: true,
            updatedAt: now,
          },
        ],
        defaultSelection: {
          providerId: "provider_1",
          modelId: "design-model",
          reasoningEffort: "medium",
        },
      }),
      onModelProviderCatalogChange: vi.fn().mockReturnValue(() => undefined),
      selectAgentAttachments: vi.fn().mockResolvedValue([]),
    } as unknown as DesktopApi;

    const { container } = render(
      <AgentTimeline
        activeRunId={null}
        conversationId={null}
        conversationTitle={null}
        error={null}
        events={[]}
        onStartConversation={onStartConversation}
        onStop={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(true)}
        timeline={[]}
      />,
    );

    const prompt = screen.getByLabelText("Continue the task");
    const editor = container.querySelector("[data-agent-prompt-editor]");
    const toolbar = container.querySelector("[data-agent-prompt-toolbar]");
    expect(screen.getByText("Start with a prompt")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Your first message creates the Conversation and starts the design task.",
      ),
    ).toBeInTheDocument();
    expect(prompt).toBeEnabled();
    expect(prompt.parentElement).toBe(editor);
    expect(prompt.nextElementSibling).toBe(toolbar);

    await user.type(prompt, "Design the website launch");
    const send = screen.getByRole("button", { name: "Send" });
    await waitFor(() => expect(send).toBeEnabled());
    await user.click(send);

    expect(onStartConversation).toHaveBeenCalledWith(
      "Design the website launch",
      expect.objectContaining({
        providerId: "provider_1",
        modelId: "design-model",
      }),
      [],
    );
  });

  it("merges durable and live completed items without duplicates", () => {
    const timeline: SessionTimelineItem[] = [
      {
        itemId: "run:run_1",
        sessionId: "conversation_1",
        runId: "run_1",
        sequence: 1,
        createdAt: now,
        updatedAt: now,
        type: "run",
        status: "completed",
        startedAt: now,
        finishedAt: now,
        stopReason: "complete",
      },
      {
        itemId: "message:message_1",
        sessionId: "conversation_1",
        runId: "run_1",
        sequence: 4,
        createdAt: now,
        updatedAt: now,
        type: "assistant.message",
        messageId: "message_1",
        blocks: [
          { blockId: "block_1", type: "text", text: "Durable response" },
        ],
      },
      {
        itemId: "tool:tool_1",
        sessionId: "conversation_1",
        runId: "run_1",
        sequence: 3,
        createdAt: now,
        updatedAt: now,
        type: "tool",
        toolCallId: "tool_1",
        toolName: "design.update",
        input: {},
        risk: "design_write",
        status: "completed",
        result: { ok: true },
      },
    ];
    const events: AgentEvent[] = [
      {
        type: "run.completed",
        runId: "run_1",
        finishedAt: now,
        stopReason: "complete",
      },
      {
        type: "message.completed",
        runId: "run_1",
        messageId: "message_1",
        blocks: [{ blockId: "block_1", type: "text", text: "Live response" }],
      },
      {
        type: "tool.completed",
        runId: "run_1",
        toolCallId: "tool_1",
        result: { ok: true },
      },
    ];

    const { container } = render(
      <AgentTimeline
        activeRunId={null}
        conversationId="conversation_1"
        conversationTitle="Conversation"
        error={null}
        events={events}
        onStop={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(true)}
        timeline={timeline}
      />,
    );

    expect(container.querySelectorAll("[data-agent-item]")).toHaveLength(2);
    expect(screen.queryByText("Task completed")).not.toBeInTheDocument();
    expect(screen.queryByText("Agent response")).not.toBeInTheDocument();
    expect(screen.getAllByText("Design change completed")).toHaveLength(1);
    expect(screen.getByText("Durable response")).toBeInTheDocument();
    expect(screen.queryByText("Live response")).not.toBeInTheDocument();
  });

  it("renders completed assistant Markdown without executing HTML or loading remote images", () => {
    const { container } = render(
      <AgentTimeline
        activeRunId={null}
        conversationId="conversation_1"
        conversationTitle="Conversation"
        error={null}
        events={[]}
        onStop={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(true)}
        timeline={[
          {
            itemId: "message:markdown",
            sessionId: "conversation_1",
            runId: "run_markdown",
            sequence: 1,
            createdAt: now,
            updatedAt: now,
            type: "assistant.message",
            messageId: "message_markdown",
            blocks: [
              {
                blockId: "block_markdown",
                type: "text",
                text: [
                  "**登录页**",
                  "",
                  "- 邮箱与密码",
                  "- `记住登录`",
                  "",
                  "[外部链接](https://example.com)",
                  "",
                  "<script>window.compromised = true</script>",
                  "",
                  "![remote](https://example.com/tracker.png)",
                ].join("\n"),
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByText("登录页").tagName).toBe("STRONG");
    expect(
      container.querySelector("[data-agent-message-markdown] ul"),
    ).toHaveTextContent("邮箱与密码");
    expect(screen.getByText("记住登录").tagName).toBe("CODE");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
    expect(container).not.toHaveTextContent("window.compromised");
    expect(container).not.toHaveTextContent("**登录页**");
  });

  it("keeps a live reply before the next optimistic user message", () => {
    const userMessage = (
      runId: string,
      sequence: number,
      content: string,
    ): SessionTimelineItem => ({
      itemId: `message:${runId}_user`,
      sessionId: "conversation_1",
      runId,
      sequence,
      createdAt: now,
      updatedAt: now,
      type: "user.message",
      messageId: `${runId}_user`,
      content,
      documentId: "document_1",
      revision: 0,
      scope: { kind: "page", pageId: "page_1", selectedNodeIds: [] },
    });
    const events: AgentEvent[] = [
      { type: "run.started", runId: "run_1", startedAt: now },
      {
        type: "message.completed",
        runId: "run_1",
        messageId: "message_run_1_assistant",
        blocks: [{ blockId: "block_1", type: "text", text: "First reply" }],
      },
      {
        type: "run.completed",
        runId: "run_1",
        finishedAt: now,
        stopReason: "complete",
      },
    ];

    const { container } = render(
      <AgentTimeline
        activeRunId="run_2"
        conversationId="conversation_1"
        conversationTitle="Conversation"
        error={null}
        events={events}
        onStop={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(true)}
        timeline={[
          userMessage("run_1", 1, "First request"),
          userMessage("run_2", 2, "Second request"),
        ]}
      />,
    );

    expect(
      [...container.querySelectorAll("[data-agent-message] p")].map(
        (element) => element.textContent,
      ),
    ).toEqual(["First request", "First reply", "Second request"]);
  });

  it("keeps a complete durable reply when the live window has only its suffix", () => {
    const messageId = "message_run_complete_assistant";
    const timeline: SessionTimelineItem[] = [
      {
        itemId: "message:run_complete_user",
        sessionId: "conversation_1",
        runId: "run_complete",
        sequence: 1,
        createdAt: now,
        updatedAt: now,
        type: "user.message",
        messageId: "run_complete_user",
        content: "Why did this happen?",
        documentId: "document_1",
        revision: 0,
        scope: { kind: "page", pageId: "page_1", selectedNodeIds: [] },
      },
      {
        itemId: `message:${messageId}`,
        sessionId: "conversation_1",
        runId: "run_complete",
        sequence: 2,
        createdAt: now,
        updatedAt: now,
        type: "assistant.message",
        messageId,
        blocks: [
          {
            blockId: "block_complete",
            type: "text",
            text: "Complete opening paragraph.\n\n- First point\n- Final point",
          },
        ],
      },
    ];
    const events: AgentEvent[] = [
      {
        type: "message.delta",
        runId: "run_complete",
        messageId,
        blockId: "block_complete",
        delta: "- Final point",
      },
      { type: "run.started", runId: "run_next", startedAt: now },
    ];

    const { container } = render(
      <AgentTimeline
        activeRunId="run_next"
        conversationId="conversation_1"
        conversationTitle="Conversation"
        error={null}
        events={events}
        onStop={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(true)}
        timeline={timeline}
      />,
    );

    expect(
      container.querySelectorAll("[data-agent-message]")[1],
    ).toHaveTextContent("Complete opening paragraph. First point Final point");
  });

  it("shows native design tools as one user-facing canvas activity", () => {
    const events: AgentEvent[] = [
      {
        type: "run.started",
        runId: "run_canvas_1",
        startedAt: now,
      },
      {
        type: "tool.requested",
        runId: "run_canvas_1",
        toolCallId: "tool_canvas_1",
        toolName: "opendesign_apply_transaction",
        input: { label: "Build the page", commands: [] },
        risk: "design_write",
      },
      {
        type: "tool.completed",
        runId: "run_canvas_1",
        toolCallId: "tool_canvas_1",
        result: { ok: true },
        revision: 4,
        transactionId: "transaction_canvas_1",
      },
      {
        type: "run.completed",
        runId: "run_canvas_1",
        finishedAt: now,
        stopReason: "complete",
      },
    ];

    const { container } = render(
      <AgentTimeline
        activeRunId={null}
        conversationId="conversation_1"
        conversationTitle="Conversation"
        error={null}
        events={events}
        onStop={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(true)}
        timeline={[]}
      />,
    );

    expect(container.querySelectorAll("[data-agent-item]")).toHaveLength(1);
    expect(screen.getByText("Canvas updated")).toBeInTheDocument();
    expect(
      screen.queryByText("Working on your design"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Task completed")).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent("opendesign_apply_transaction");
    expect(container).not.toHaveTextContent("transaction_canvas_1");
    expect(container).not.toHaveTextContent("run_canvas_1");
  });

  it("clears transient progress detail when a design tool completes", () => {
    const events: AgentEvent[] = [
      {
        type: "tool.requested",
        runId: "run_place_1",
        toolCallId: "tool_place_1",
        toolName: "opendesign_place_image",
        input: {},
        risk: "design_write",
      },
      {
        type: "tool.progress",
        runId: "run_place_1",
        toolCallId: "tool_place_1",
        message: "Validating design tool parameters and revision",
        progress: 0.15,
      },
      {
        type: "tool.completed",
        runId: "run_place_1",
        toolCallId: "tool_place_1",
        result: { ok: true },
        revision: 4,
      },
    ];

    const { container } = render(
      <AgentTimeline
        activeRunId={"run_place_1"}
        conversationId="conversation_1"
        conversationTitle="Conversation"
        error={null}
        events={events}
        onStop={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(true)}
        timeline={[]}
      />,
    );

    expect(screen.getByText("Design change completed")).toBeInTheDocument();
    expect(container).not.toHaveTextContent(
      "Validating design tool parameters and revision",
    );
  });

  it("does not restore stale progress detail from completed durable tools", () => {
    const timeline: SessionTimelineItem[] = [
      {
        itemId: "tool:durable_place_tool",
        sessionId: "conversation_1",
        runId: "run_place_1",
        sequence: 1,
        createdAt: now,
        updatedAt: now,
        type: "tool",
        toolCallId: "durable_place_tool",
        toolName: "opendesign_place_image",
        input: {},
        risk: "design_write",
        status: "completed",
        progressMessage: "Validating design tool parameters and revision",
        result: { ok: true },
        revision: 4,
      },
    ];

    const { container } = render(
      <AgentTimeline
        activeRunId={null}
        conversationId="conversation_1"
        conversationTitle="Conversation"
        error={null}
        events={[]}
        onStop={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(true)}
        timeline={timeline}
      />,
    );

    expect(screen.getByText("Design change completed")).toBeInTheDocument();
    expect(container).not.toHaveTextContent(
      "Validating design tool parameters and revision",
    );
  });

  it("shows semantic hierarchy work as native layer activity", () => {
    const events: AgentEvent[] = [
      {
        type: "tool.requested",
        runId: "run_hierarchy_1",
        toolCallId: "tool_hierarchy_1",
        toolName: "opendesign_edit_hierarchy",
        input: {
          action: "group",
          pageId: "page_1",
          nodeIds: ["body", "face"],
          groupId: "mascot",
        },
        risk: "design_write",
      },
      {
        type: "tool.completed",
        runId: "run_hierarchy_1",
        toolCallId: "tool_hierarchy_1",
        result: { action: "group", groupId: "mascot" },
        revision: 4,
        transactionId: "transaction_hierarchy_1",
      },
    ];

    const { container } = render(
      <AgentTimeline
        activeRunId={null}
        conversationId="conversation_1"
        conversationTitle="Conversation"
        error={null}
        events={events}
        onStop={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(true)}
        timeline={[]}
      />,
    );

    expect(screen.getByText("Layer structure updated")).toBeInTheDocument();
    expect(container).not.toHaveTextContent("opendesign_edit_hierarchy");
    expect(container).not.toHaveTextContent("transaction_hierarchy_1");
  });

  it("shows precise arrangement as native layer activity", () => {
    const events: AgentEvent[] = [
      {
        type: "tool.requested",
        runId: "run_arrange_1",
        toolCallId: "tool_arrange_1",
        toolName: "opendesign_arrange_layers",
        input: {
          action: "distribute-horizontal",
          pageId: "page_1",
          nodeIds: ["one", "two", "three"],
        },
        risk: "design_write",
      },
      {
        type: "tool.completed",
        runId: "run_arrange_1",
        toolCallId: "tool_arrange_1",
        result: { action: "distribute-horizontal", resolvedSpacing: 24 },
        revision: 5,
        transactionId: "transaction_arrange_1",
      },
    ];

    const { container } = render(
      <AgentTimeline
        activeRunId={null}
        conversationId="conversation_1"
        conversationTitle="Conversation"
        error={null}
        events={events}
        onStop={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(true)}
        timeline={[]}
      />,
    );

    expect(screen.getByText("Layer arrangement updated")).toBeInTheDocument();
    expect(container).not.toHaveTextContent("opendesign_arrange_layers");
    expect(container).not.toHaveTextContent("transaction_arrange_1");
  });

  it("replaces internal model attempt failures with one recoverable status", () => {
    const events: AgentEvent[] = [
      {
        type: "run.started",
        runId: "run_internal_1",
        startedAt: now,
      },
      {
        type: "agent.error",
        code: "run_failed",
        runId: "run_internal_1",
        message: "Model attempt did not complete for run_internal_1_attempt_1",
      },
    ];

    const { container } = render(
      <AgentTimeline
        activeRunId={null}
        conversationId="conversation_1"
        conversationTitle="Conversation"
        error="Model attempt did not complete for run_internal_1_attempt_1"
        events={events}
        onStop={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(true)}
        timeline={[]}
      />,
    );

    expect(container.querySelectorAll("[data-agent-item]")).toHaveLength(1);
    expect(
      screen.getByText("The model response was interrupted. Try again."),
    ).toBeInTheDocument();
    expect(container).not.toHaveTextContent("run_internal_1");
    expect(container).not.toHaveTextContent("attempt_1");
  });

  it.each([
    [
      "first-response" as const,
      180_000,
      "Model did not start responding",
      "No Provider response arrived within 3 min.",
    ],
    [
      "stream-idle" as const,
      120_000,
      "Model response stalled",
      "The response stream had no activity for 2 min.",
    ],
    [
      "total" as const,
      900_000,
      "Model time limit reached",
      "The Provider request reached its 15 min total time limit.",
    ],
  ])(
    "keeps %s timeout phase, threshold, correlation, and retry semantics visible",
    (phase, thresholdMs, title, detail) => {
      const { container } = render(
        <AgentTimeline
          activeRunId={null}
          conversationId="conversation_1"
          conversationTitle="Conversation"
          error={null}
          events={[
            {
              type: "agent.error",
              code: "provider_timeout",
              runId: `run_${phase}`,
              message: "Provider timed out",
              failure: {
                code: "provider_timeout",
                message: "Provider timed out",
                retryable: true,
                provider: "provider_1",
                ...(phase === "stream-idle"
                  ? { providerRequestId: "provider_request_1" }
                  : {}),
                modelRequestId: `model_request_${phase}`,
                timeout: { phase, thresholdMs },
              },
            },
            {
              type: "run.completed",
              runId: `run_${phase}`,
              finishedAt: now,
              stopReason: "error",
            },
          ]}
          onStop={vi.fn()}
          onSubmit={vi.fn().mockResolvedValue(true)}
          timeline={[]}
        />,
      );

      expect(screen.getByText(title)).toBeInTheDocument();
      expect(container).toHaveTextContent(detail);
      expect(container).toHaveTextContent(
        `Model request: model_request_${phase}`,
      );
      expect(container).toHaveTextContent(
        phase === "stream-idle"
          ? "Provider request: provider_request_1"
          : "Provider request ID was not available before the stream ended.",
      );
      expect(container).toHaveTextContent("This request can be retried.");
    },
  );

  it("distinguishes a Provider connection interruption from a timeout", () => {
    const { container } = render(
      <AgentTimeline
        activeRunId={null}
        conversationId="conversation_1"
        conversationTitle="Conversation"
        error={null}
        events={[
          {
            type: "agent.error",
            code: "provider_error",
            runId: "run_terminated",
            message: "terminated",
            failure: {
              code: "provider_error",
              message: "terminated",
              retryable: true,
              provider: "provider_1",
              providerRequestId: "resp_terminated",
              modelRequestId: "model_terminated",
            },
          },
          {
            type: "run.completed",
            runId: "run_terminated",
            finishedAt: now,
            stopReason: "error",
          },
        ]}
        onStop={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(true)}
        timeline={[]}
      />,
    );

    expect(
      screen.getByText("Model connection interrupted"),
    ).toBeInTheDocument();
    expect(container).toHaveTextContent("terminated");
    expect(container).not.toHaveTextContent("timed out");
    expect(container).toHaveTextContent("This request can be retried.");
  });

  it("classifies a Renderer activity timeout as a canvas failure", () => {
    const { container } = render(
      <AgentTimeline
        activeRunId="run_canvas_timeout"
        conversationId="conversation_1"
        conversationTitle="Conversation"
        error={null}
        events={[
          {
            type: "tool.requested",
            runId: "run_canvas_timeout",
            toolCallId: "tool_canvas_timeout",
            toolName: "opendesign_capture_canvas",
            input: {},
            risk: "read",
          },
          {
            type: "tool.failed",
            runId: "run_canvas_timeout",
            toolCallId: "tool_canvas_timeout",
            code: "renderer_idle_timeout",
            message:
              "renderer_tool.timeout.idle: Renderer design work made no progress for 90000 ms during capturing",
            retryable: true,
            recoverable: true,
          },
        ]}
        onStop={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(true)}
        timeline={[]}
      />,
    );

    expect(screen.getByText("Canvas operation stalled")).toBeInTheDocument();
    expect(container).toHaveTextContent(
      "The canvas operation stopped reporting progress",
    );
    expect(container).not.toHaveTextContent("The model took too long");
  });

  it("shows a terminal canvas circuit failure without claiming completion", () => {
    const { container } = render(
      <AgentTimeline
        activeRunId="run_canvas_circuit"
        conversationId="conversation_1"
        conversationTitle="Conversation"
        error={null}
        events={[
          {
            type: "tool.requested",
            runId: "run_canvas_circuit",
            toolCallId: "tool_canvas_circuit",
            toolName: "opendesign_capture_canvas",
            input: {},
            risk: "read",
          },
          {
            type: "tool.failed",
            runId: "run_canvas_circuit",
            toolCallId: "tool_canvas_circuit",
            code: "renderer_circuit_open",
            message: "renderer_tool.circuit_open: stopped",
            retryable: false,
            recoverable: false,
          },
          {
            type: "agent.error",
            code: "renderer_circuit_open",
            runId: "run_canvas_circuit",
            message: "renderer_tool.circuit_open: stopped",
            failure: {
              code: "renderer_circuit_open",
              message: "renderer_tool.circuit_open: stopped",
              retryable: false,
            },
          },
          {
            type: "run.completed",
            runId: "run_canvas_circuit",
            finishedAt: now,
            stopReason: "error",
          },
        ]}
        onStop={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(true)}
        timeline={[]}
      />,
    );

    expect(
      screen.getAllByText("Canvas renderer repeatedly stalled").length,
    ).toBeGreaterThan(0);
    expect(container).toHaveTextContent("OpenDesign stopped this task");
    expect(container).toHaveTextContent(
      "Committed design revisions were preserved",
    );
    expect(container).not.toHaveTextContent("Task completed");
  });

  it("shows one live reconnect status and clears it after recovery", () => {
    const props = {
      activeRunId: "run_retry",
      conversationId: "conversation_1",
      conversationTitle: "Conversation",
      error: null,
      onStop: vi.fn(),
      onSubmit: vi.fn().mockResolvedValue(true),
      timeline: [],
    };
    const { rerender } = render(
      <AgentTimeline
        {...props}
        events={[
          { type: "run.started", runId: "run_retry", startedAt: now },
          {
            type: "model.retrying",
            runId: "run_retry",
            retry: 1,
            maxRetries: 5,
            delayMs: 400,
          },
          {
            type: "model.retrying",
            runId: "run_retry",
            retry: 2,
            maxRetries: 5,
            delayMs: 900,
          },
        ]}
      />,
    );

    expect(screen.getByText("Reconnecting 2/5")).toBeInTheDocument();
    expect(screen.queryByText("Reconnecting 1/5")).not.toBeInTheDocument();

    rerender(
      <AgentTimeline
        {...props}
        events={[
          { type: "run.started", runId: "run_retry", startedAt: now },
          {
            type: "model.retrying",
            runId: "run_retry",
            retry: 2,
            maxRetries: 5,
            delayMs: 900,
          },
          {
            type: "model.recovered",
            runId: "run_retry",
            retriesUsed: 2,
            maxRetries: 5,
          },
        ]}
      />,
    );

    expect(screen.queryByText(/Reconnecting/)).not.toBeInTheDocument();
  });

  it("hides reconnect activity as soon as the user stops the Run", async () => {
    const user = userEvent.setup();
    const stopResult = deferred<boolean>();
    render(
      <AgentTimeline
        activeRunId="run_retry_stop"
        conversationId="conversation_1"
        conversationTitle="Conversation"
        error={null}
        events={[
          { type: "run.started", runId: "run_retry_stop", startedAt: now },
          {
            type: "model.retrying",
            runId: "run_retry_stop",
            retry: 2,
            maxRetries: 5,
            delayMs: 900,
          },
        ]}
        onStop={() => stopResult.promise}
        onSubmit={vi.fn().mockResolvedValue(true)}
        timeline={[]}
      />,
    );
    expect(screen.getByText("Reconnecting 2/5")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Stop" }));

    expect(screen.queryByText(/Reconnecting/)).not.toBeInTheDocument();
    expect(screen.getByText("Stopping request")).toBeInTheDocument();
    stopResult.resolve(true);
  });

  it("keeps stopping when a continuation child arrives during cancellation", async () => {
    const user = userEvent.setup();
    const stopResult = deferred<boolean>();
    const baseProps = {
      conversationId: "conversation_1",
      conversationTitle: "Conversation",
      error: null,
      onStop: () => stopResult.promise,
      onSubmit: vi.fn().mockResolvedValue(true),
      timeline: [],
    };
    const { rerender } = render(
      <AgentTimeline
        {...baseProps}
        activeRunId="run_parent"
        events={[{ type: "run.started", runId: "run_parent", startedAt: now }]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Stop" }));

    rerender(
      <AgentTimeline
        {...baseProps}
        activeRunId="run_child"
        events={[
          {
            type: "run.continuation",
            runId: "run_parent",
            status: "scheduled",
            attempt: 1,
            maxAttempts: 3,
            reason: "incomplete",
            nextRunId: "run_child",
          },
          {
            type: "run.started",
            runId: "run_child",
            startedAt: now,
            continuation: {
              parentRunId: "run_parent",
              rootRunId: "run_parent",
              attempt: 1,
              maxAttempts: 3,
              reason: "incomplete",
            },
          },
        ]}
      />,
    );

    expect(screen.getByText("Stopping request")).toBeInTheDocument();
    expect(screen.queryByText(/Reconnecting/)).not.toBeInTheDocument();
    stopResult.resolve(true);
  });

  it("downgrades an old terminal error to a compact history row when a new Run starts", () => {
    const { container } = render(
      <AgentTimeline
        activeRunId="run_current"
        conversationId="conversation_1"
        conversationTitle="Conversation"
        error={null}
        events={[
          {
            type: "agent.error",
            code: "context_budget_exceeded",
            runId: "run_previous",
            message: "Conversation context remains too large",
            failure: {
              code: "context_budget_exceeded",
              message: "Conversation context remains too large",
              retryable: false,
            },
          },
          {
            type: "run.started",
            runId: "run_current",
            startedAt: now,
          },
        ]}
        onStop={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(true)}
        timeline={[]}
      />,
    );

    const historyRow = screen.getByText("Previous task ended").closest("li");
    expect(historyRow).toHaveAttribute("data-historical", "true");
    expect(historyRow).toHaveAttribute("data-state", "done");
    expect(screen.getByText("Working on your design")).toBeInTheDocument();
    expect(container.querySelectorAll("[data-agent-caret]")).toHaveLength(0);
  });

  it("finalizes a failed partial message and leaves only the current Run streaming", () => {
    const { container } = render(
      <AgentTimeline
        activeRunId="run_current"
        conversationId="conversation_1"
        conversationTitle="Conversation"
        error={null}
        events={[
          {
            type: "message.delta",
            runId: "run_failed",
            messageId: "message_failed",
            blockId: "block_failed",
            delta: "Interrupted response",
          },
          {
            type: "agent.error",
            code: "run_failed",
            runId: "run_failed",
            message: "stream error: INTERNAL_ERROR; received from peer",
          },
          {
            type: "message.delta",
            runId: "run_current",
            messageId: "message_current",
            blockId: "block_current",
            delta: "Current response",
          },
        ]}
        onStop={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(true)}
        timeline={[]}
      />,
    );

    const failedMessage = screen
      .getByText("Interrupted response")
      .closest("li");
    const currentMessage = screen.getByText("Current response").closest("li");
    expect(failedMessage).toHaveAttribute("data-state", "done");
    expect(currentMessage).toHaveAttribute("data-state", "active");
    expect(container.querySelectorAll("[data-agent-caret]")).toHaveLength(1);
    expect(currentMessage?.querySelector("[data-agent-caret]")).not.toBeNull();
  });

  it("shows provider reasoning summaries but hides native tool plumbing", () => {
    const timeline: SessionTimelineItem[] = [
      {
        itemId: "message:mixed_response",
        sessionId: "conversation_1",
        runId: "run_history_1",
        sequence: 1,
        createdAt: now,
        updatedAt: now,
        type: "assistant.message",
        messageId: "mixed_response",
        blocks: [
          {
            blockId: "reasoning_block_1",
            type: "reasoning_summary",
            status: "completed",
            summary: "**Planning internal transaction sequencing**",
          },
          {
            blockId: "response_block_1",
            type: "text",
            text: "I will build the editable shell first.",
          },
        ],
      },
      {
        itemId: "message:reasoning_only_2",
        sessionId: "conversation_1",
        runId: "run_history_1",
        sequence: 2,
        createdAt: now,
        updatedAt: now,
        type: "assistant.message",
        messageId: "reasoning_only_2",
        blocks: [
          {
            blockId: "reasoning_block_2",
            type: "reasoning_summary",
            status: "completed",
            summary: "Checking spacing and hierarchy",
          },
        ],
      },
      {
        itemId: "tool:durable_canvas_tool",
        sessionId: "conversation_1",
        runId: "run_history_1",
        sequence: 3,
        createdAt: now,
        updatedAt: now,
        type: "tool",
        toolCallId: "durable_canvas_tool",
        toolName: "opendesign_apply_transaction",
        input: {},
        risk: "design_write",
        status: "completed",
        progressMessage: "Validating design tool parameters and revision",
        result: { ok: true },
        revision: 3,
      },
    ];

    const { container } = render(
      <AgentTimeline
        activeRunId={null}
        conversationId="conversation_1"
        conversationTitle="Conversation"
        error={null}
        events={[]}
        onStop={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(true)}
        timeline={timeline}
      />,
    );

    expect(screen.getByText("Canvas updated")).toBeInTheDocument();
    expect(
      screen.getByText("I will build the editable shell first."),
    ).toBeInTheDocument();
    const summaries = screen.getAllByText("Model thinking summary");
    const disclosures = summaries.map((summary) => summary.closest("details"));
    expect(disclosures[0]).not.toHaveAttribute("open");
    expect(disclosures[1]).not.toHaveAttribute("open");
    expect(container.querySelectorAll("[data-agent-reasoning]")).toHaveLength(
      2,
    );
    fireEvent.click(summaries[1]);
    expect(disclosures[1]).toHaveAttribute("open");
    const timelineItems = container.querySelectorAll("[data-agent-item]");
    expect(timelineItems[0]).toHaveTextContent(
      "I will build the editable shell first.",
    );
    expect(timelineItems[1]).toHaveTextContent("Planning internal");
    expect(timelineItems[2]).toHaveTextContent(
      "Checking spacing and hierarchy",
    );
    expect(timelineItems[3]).toHaveTextContent("Canvas updated");
    expect(container).toHaveTextContent("Planning internal");
    expect(container).toHaveTextContent("Checking spacing and hierarchy");
    expect(container).toHaveTextContent(
      "It does not indicate a system test or an executed canvas operation.",
    );
    expect(container).not.toHaveTextContent("revision");
    expect(container).not.toHaveTextContent("Response completed");
  });

  it("folds adjacent completed tools in place without hiding their details", () => {
    const timeline: SessionTimelineItem[] = [
      {
        itemId: "message:before_tools",
        sessionId: "conversation_1",
        runId: "run_tools",
        sequence: 1,
        createdAt: now,
        updatedAt: now,
        type: "assistant.message",
        messageId: "before_tools",
        blocks: [
          {
            blockId: "before_tools_text",
            type: "text",
            text: "先读取并整理画布。",
          },
        ],
      },
      {
        itemId: "tool:inspect",
        sessionId: "conversation_1",
        runId: "run_tools",
        sequence: 2,
        createdAt: now,
        updatedAt: now,
        type: "tool",
        toolCallId: "inspect",
        toolName: "opendesign_inspect_document",
        input: {},
        risk: "read",
        status: "completed",
        result: {},
      },
      {
        itemId: "tool:plan",
        sessionId: "conversation_1",
        runId: "run_tools",
        sequence: 3,
        createdAt: now,
        updatedAt: now,
        type: "tool",
        toolCallId: "plan",
        toolName: "opendesign_define_design_plan",
        input: {},
        risk: "design_write",
        status: "completed",
        result: {},
      },
      {
        itemId: "message:after_tools",
        sessionId: "conversation_1",
        runId: "run_tools",
        sequence: 4,
        createdAt: now,
        updatedAt: now,
        type: "assistant.message",
        messageId: "after_tools",
        blocks: [
          {
            blockId: "after_tools_text",
            type: "text",
            text: "接下来开始设计。",
          },
        ],
      },
    ];

    const { container } = render(
      <AgentTimeline
        activeRunId={null}
        conversationId="conversation_1"
        conversationTitle="Conversation"
        error={null}
        events={[]}
        onStop={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(true)}
        timeline={timeline}
      />,
    );

    const group = container.querySelector("[data-agent-tool-group]");
    expect(group).not.toHaveAttribute("open");
    expect(screen.getByText("Ran 2 operations")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Ran 2 operations"));
    expect(group).toHaveAttribute("open");
    expect(group).toHaveTextContent("Canvas read");
    expect(group).toHaveTextContent("Design plan ready");
    const timelineItems = container.querySelectorAll("[data-agent-item]");
    expect(timelineItems[0]).toHaveTextContent("先读取并整理画布。");
    expect(timelineItems[1]).toHaveAttribute("data-kind", "tool-group");
    expect(timelineItems[2]).toHaveTextContent("接下来开始设计。");
  });

  it("does not repeat a run-bound Agent error below the timeline", () => {
    const message =
      "opendesign_apply_transaction produced 4 consecutive invalid tool calls without a successful document revision.";
    const { container } = render(
      <AgentTimeline
        activeRunId={null}
        conversationId="conversation_1"
        conversationTitle="Conversation"
        error={message}
        events={[
          {
            type: "agent.error",
            code: "tool_protocol_no_progress",
            runId: "run_invalid_tools",
            message,
            failure: {
              code: "tool_protocol_no_progress",
              message,
              retryable: false,
            },
          },
          {
            type: "run.completed",
            runId: "run_invalid_tools",
            finishedAt: now,
            stopReason: "error",
          },
        ]}
        onStop={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(true)}
        timeline={[]}
      />,
    );

    expect(
      screen.getAllByText("Model cannot execute this design tool"),
    ).toHaveLength(1);
    expect(
      container.querySelectorAll("[data-agent-item][data-state='error']"),
    ).toHaveLength(1);
  });

  it("does not present interrupted durable activity as an active run", () => {
    const timeline: SessionTimelineItem[] = [
      {
        itemId: "run:run_interrupted",
        sessionId: "conversation_1",
        runId: "run_interrupted",
        sequence: 1,
        createdAt: now,
        updatedAt: now,
        type: "run",
        status: "started",
        startedAt: now,
      },
      {
        itemId: "tool:tool_interrupted",
        sessionId: "conversation_1",
        runId: "run_interrupted",
        sequence: 2,
        createdAt: now,
        updatedAt: now,
        type: "tool",
        toolCallId: "tool_interrupted",
        toolName: "opendesign_apply_transaction",
        input: {},
        risk: "design_write",
        status: "running",
      },
    ];

    const { container } = render(
      <AgentTimeline
        activeRunId={null}
        conversationId="conversation_1"
        conversationTitle="Conversation"
        error={null}
        events={[]}
        onStop={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(true)}
        timeline={timeline}
      />,
    );

    expect(container).not.toHaveTextContent("Working on your design");
    expect(container).not.toHaveTextContent("Building on the canvas");
  });

  it("keeps recoverable canvas scope internals out of the user timeline", () => {
    const events: AgentEvent[] = [
      {
        type: "tool.requested",
        runId: "run_scope_1",
        toolCallId: "tool_scope_1",
        toolName: "opendesign_apply_transaction",
        input: {},
        risk: "design_write",
      },
      {
        type: "tool.failed",
        runId: "run_scope_1",
        toolCallId: "tool_scope_1",
        code: "tool_error",
        message:
          "Agent command login-002 targets a parent outside the registered page scope",
      },
    ];

    const { container } = render(
      <AgentTimeline
        activeRunId={null}
        conversationId="conversation_1"
        conversationTitle="Conversation"
        error={null}
        events={events}
        onStop={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(true)}
        timeline={[]}
      />,
    );

    expect(container.querySelectorAll("[data-agent-item]")).toHaveLength(0);
    expect(container).not.toHaveTextContent(
      "This change did not match the active canvas scope",
    );
    expect(container).not.toHaveTextContent("login-002");
    expect(container).not.toHaveTextContent("registered page scope");
  });

  it("shows the exact invariant target and retry recovery state", () => {
    const events: AgentEvent[] = [
      {
        type: "tool.requested",
        runId: "run_invariant_1",
        toolCallId: "tool_invariant_1",
        toolName: "opendesign_apply_transaction",
        input: {},
        risk: "design_write",
      },
      {
        type: "tool.failed",
        runId: "run_invariant_1",
        toolCallId: "tool_invariant_1",
        code: "design.invalid",
        message: "Transaction would violate document invariants",
        retryable: false,
        recoverable: true,
        details: {
          kind: "design-transaction",
          fingerprint: "design_deadbeef",
          issues: [
            {
              commandId: "update_card",
              nodeId: "card_1",
              path: "/nodesById/card_1/properties",
              message: "Expected union value",
            },
          ],
          recovery: {
            action: "inspect-and-revise",
            toolName: "opendesign_inspect_document",
            required: true,
          },
          attempt: 2,
          maxAttempts: 2,
          retrySuppressed: true,
        },
      },
    ];

    const { container } = render(
      <AgentTimeline
        activeRunId="run_invariant_1"
        conversationId="conversation_1"
        conversationTitle="Conversation"
        error={null}
        events={events}
        onStop={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(true)}
        timeline={[]}
      />,
    );

    expect(screen.getByText(/command update_card/)).toHaveTextContent(
      "node card_1",
    );
    expect(screen.getByText(/command update_card/)).toHaveTextContent(
      "/nodesById/card_1/properties",
    );
    expect(container).toHaveTextContent(
      "Inspect the current document before another retry",
    );
  });

  it("keeps recoverable design workflow guard retries out of the visible timeline", () => {
    const message =
      "design_workflow.capture_required: Call opendesign_capture_canvas once before retrying review";
    const timeline: SessionTimelineItem[] = [
      {
        itemId: "tool:durable_review_retry",
        sessionId: "conversation_1",
        runId: "run_review_retry",
        sequence: 1,
        createdAt: now,
        updatedAt: now,
        type: "tool",
        toolCallId: "durable_review_retry",
        toolName: "opendesign_record_visual_review",
        input: {},
        risk: "read",
        status: "failed",
        error: { code: "tool_error", message },
      },
    ];
    const events: AgentEvent[] = [
      {
        type: "tool.requested",
        runId: "run_review_retry",
        toolCallId: "live_review_retry",
        toolName: "opendesign_record_visual_review",
        input: {},
        risk: "read",
      },
      {
        type: "tool.failed",
        runId: "run_review_retry",
        toolCallId: "live_review_retry",
        code: "tool_error",
        message,
      },
    ];

    const { container } = render(
      <AgentTimeline
        activeRunId="run_review_retry"
        conversationId="conversation_1"
        conversationTitle="Conversation"
        error={null}
        events={events}
        onStop={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(true)}
        timeline={timeline}
      />,
    );

    expect(container).not.toHaveTextContent("Design change failed");
    expect(container).not.toHaveTextContent("design_workflow");
    expect(container).not.toHaveTextContent("capture_canvas once");
  });

  it("keeps recoverable stale-inspection corrections out of the visible timeline", () => {
    const message =
      "design_workflow.inspection_stale: Inspect the current document revision before continuing; inspected 417, current 418";
    const { container } = render(
      <AgentTimeline
        activeRunId="run_inspection_retry"
        conversationId="conversation_1"
        conversationTitle="Conversation"
        error={null}
        events={[
          {
            type: "tool.requested",
            runId: "run_inspection_retry",
            toolCallId: "page_after_rename",
            toolName: "opendesign_manage_pages",
            input: {},
            risk: "design_write",
          },
          {
            type: "tool.failed",
            runId: "run_inspection_retry",
            toolCallId: "page_after_rename",
            code: "tool_error",
            message,
            recoverable: true,
          },
        ]}
        onStop={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(true)}
        timeline={[]}
      />,
    );

    expect(container).not.toHaveTextContent("Design change failed");
    expect(container).not.toHaveTextContent("inspection_stale");
    expect(container).not.toHaveTextContent("inspected 417");
  });

  it("keeps recoverable pre-execution corrections out of the visible timeline", () => {
    const { container } = render(
      <AgentTimeline
        activeRunId="run_recovery"
        conversationId="conversation_1"
        conversationTitle="Conversation"
        error={null}
        events={[
          {
            type: "tool.requested",
            runId: "run_recovery",
            toolCallId: "tool_invalid",
            toolName: "opendesign_create_or_edit_pages",
            input: {},
            risk: "design_write",
          },
          {
            type: "tool.failed",
            runId: "run_recovery",
            toolCallId: "tool_invalid",
            code: "invalid_tool_input",
            message:
              'Validation failed for tool "opendesign_create_or_edit_pages": action: must be string',
            recoverable: true,
          },
        ]}
        onStop={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(true)}
        timeline={[]}
      />,
    );

    expect(container).not.toHaveTextContent("Design change failed");
    expect(container).not.toHaveTextContent("Validation failed");
  });

  it("keeps the complete Conversation history visible", () => {
    const timeline: SessionTimelineItem[] = Array.from(
      { length: 45 },
      (_, index) => ({
        itemId: `message:user_${index}`,
        sessionId: "conversation_1",
        runId: `run_${index}`,
        sequence: index + 1,
        createdAt: now,
        updatedAt: now,
        type: "user.message" as const,
        messageId: `user_${index}`,
        content: `User message ${index + 1}`,
        documentId: "document_1",
        revision: 0,
        scope: {
          kind: "document" as const,
          selectedNodeIds: [],
        },
      }),
    );

    render(
      <AgentTimeline
        activeRunId={null}
        conversationId="conversation_1"
        conversationTitle="Conversation"
        error={null}
        events={[]}
        onStop={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(true)}
        timeline={timeline}
      />,
    );

    expect(screen.getByText("User message 1")).toBeInTheDocument();
    expect(screen.getByText("User message 45")).toBeInTheDocument();
    expect(screen.queryByText("You")).not.toBeInTheDocument();
  });

  it("keeps Conversation switching and drafting available during a Run", async () => {
    const user = userEvent.setup();
    const onSelectConversation = vi.fn();

    render(
      <AgentTimeline
        activeRunId="run_1"
        conversationId="conversation_1"
        conversationTitle="Conversation 1"
        conversations={[
          {
            conversationId: "conversation_1",
            originProjectId: "project_1",
            filedProjectId: "project_1",
            title: "Conversation 1",
            lifecycle: "active",
            createdAt: now,
            updatedAt: now,
          },
          {
            conversationId: "conversation_2",
            originProjectId: "project_1",
            filedProjectId: "project_1",
            title: "Conversation 2",
            lifecycle: "active",
            createdAt: now,
            updatedAt: now,
          },
        ]}
        error={null}
        events={[]}
        onSelectConversation={onSelectConversation}
        onStop={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(true)}
        timeline={[]}
      />,
    );

    const conversation = screen.getByRole("combobox", {
      name: "Conversation",
    });
    expect(conversation).toBeEnabled();
    await chooseNextOption(user, "Conversation");
    expect(onSelectConversation).toHaveBeenCalledWith("conversation_2");

    const prompt = screen.getByLabelText("Continue the task");
    expect(prompt).toBeEnabled();
    await user.type(prompt, "Draft the next instruction");
    expect(prompt).toHaveValue("Draft the next instruction");
    expect(
      screen.queryByRole("button", { name: "Send" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Stop" }).closest("form")).toBe(
      screen.getByLabelText("Continue the task").closest("form"),
    );
  });

  it("discards late attachment and submit results after switching Conversations", async () => {
    const user = userEvent.setup();
    const attachmentSelection =
      deferred<Awaited<ReturnType<DesktopApi["selectAgentAttachments"]>>>();
    const submission = deferred<boolean>();
    const onSubmit = vi.fn().mockReturnValue(submission.promise);
    window.desktop = {
      getModelProviderCatalog: vi.fn().mockResolvedValue({
        version: 3,
        providers: [
          {
            providerId: "provider_1",
            name: "Primary",
            enabled: true,
            apiFormat: "openai-responses",
            authMode: "bearer",
            baseUrl: "https://api.openai.com/v1",
            models: [
              {
                modelId: "vision-model",
                name: "Vision model",
                contextWindow: 200_000,
                maxOutputTokens: 16_384,
                capabilities: {
                  toolUse: true,
                  imageInput: true,
                  reasoning: false,
                },
                reasoningEfforts: ["off"],
              },
            ],
            hasApiKey: true,
            updatedAt: now,
          },
        ],
        defaultSelection: {
          providerId: "provider_1",
          modelId: "vision-model",
          reasoningEffort: "off",
        },
      }),
      onModelProviderCatalogChange: vi.fn().mockReturnValue(() => undefined),
      selectAgentAttachments: vi
        .fn<DesktopApi["selectAgentAttachments"]>()
        .mockReturnValue(attachmentSelection.promise),
    } as unknown as DesktopApi;
    const renderConversation = (conversationId: string, title: string) => (
      <AgentTimeline
        activeRunId={null}
        conversationId={conversationId}
        conversationTitle={title}
        error={null}
        events={[]}
        onStop={vi.fn()}
        onSubmit={onSubmit}
        timeline={[]}
      />
    );
    const { rerender } = render(
      renderConversation("conversation_1", "Conversation 1"),
    );

    await user.click(
      await screen.findByRole("button", { name: "Add attachments" }),
    );
    rerender(renderConversation("conversation_2", "Conversation 2"));
    await user.type(
      screen.getByLabelText("Continue the task"),
      "Keep this second draft",
    );
    await act(async () => {
      attachmentSelection.resolve([
        {
          attachmentId: `image_${"a".repeat(64)}`,
          name: "stale.png",
          mimeType: "image/png",
          byteSize: 512,
          previewDataUrl: "data:image/png;base64,c3RhbGU=",
        },
      ]);
      await attachmentSelection.promise;
    });
    expect(screen.queryByText("stale.png")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Continue the task")).toHaveValue(
      "Keep this second draft",
    );

    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(onSubmit).toHaveBeenCalledWith(
      "Keep this second draft",
      expect.objectContaining({ modelId: "vision-model" }),
      [],
    );
    rerender(renderConversation("conversation_3", "Conversation 3"));
    await user.type(
      screen.getByLabelText("Continue the task"),
      "Do not clear this third draft",
    );
    await act(async () => {
      submission.resolve(true);
      await submission.promise;
    });
    expect(screen.getByLabelText("Continue the task")).toHaveValue(
      "Do not clear this third draft",
    );
  });

  it("replaces the streaming caret with a stopping state immediately", async () => {
    const user = userEvent.setup();
    const onStop = vi.fn(() => new Promise<boolean>(() => undefined));
    const { container } = render(
      <AgentTimeline
        activeRunId="run_1"
        conversationId="conversation_1"
        conversationTitle="Conversation 1"
        error={null}
        events={[
          {
            type: "message.delta",
            runId: "run_1",
            messageId: "message_1",
            blockId: "block_1",
            delta: "Partial response",
          },
        ]}
        onStop={onStop}
        onSubmit={vi.fn().mockResolvedValue(true)}
        timeline={[]}
      />,
    );

    expect(
      container.querySelector(
        '[data-agent-item][data-kind="assistant"][data-state="active"]',
      ),
    ).toBeInTheDocument();
    const caret = container.querySelector("[data-agent-caret]");
    expect(caret).toBeInTheDocument();
    expect(caret?.parentElement).toHaveAttribute("data-agent-message-markdown");
    await user.click(screen.getByRole("button", { name: "Stop" }));
    expect(onStop).toHaveBeenCalledOnce();
    expect(screen.getByText("Stopping request")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stopping…" })).toBeDisabled();
    expect(
      container.querySelector(
        '[data-agent-item][data-kind="assistant"][data-state="active"]',
      ),
    ).not.toBeInTheDocument();
    expect(
      container.querySelector(
        '[data-agent-item][data-kind="assistant"][data-state="stopping"]',
      ),
    ).toBeInTheDocument();
    expect(container.querySelector("[data-agent-caret]")).toBeNull();
  });

  it("finalizes a partial assistant message when its Run is cancelled", () => {
    const { container } = render(
      <AgentTimeline
        activeRunId={null}
        conversationId="conversation_1"
        conversationTitle="Conversation 1"
        error={null}
        events={[
          {
            type: "message.delta",
            runId: "run_1",
            messageId: "message_1",
            blockId: "block_1",
            delta: "Partial response",
          },
          {
            type: "run.completed",
            runId: "run_1",
            finishedAt: now,
            stopReason: "cancelled",
          },
        ]}
        onStop={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(true)}
        timeline={[]}
      />,
    );

    expect(screen.getByText("Partial response")).toBeInTheDocument();
    expect(screen.getByText("Task stopped")).toBeInTheDocument();
    expect(
      container.querySelector(
        '[data-agent-item][data-kind="assistant"][data-state="active"]',
      ),
    ).not.toBeInTheDocument();
  });

  it("does not present an older cancelled Run as the active task outcome", () => {
    render(
      <AgentTimeline
        activeRunId="run_2"
        conversationId="conversation_1"
        conversationTitle="Conversation 1"
        error={null}
        events={[]}
        onStop={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(true)}
        timeline={[
          {
            itemId: "run:run_1",
            sessionId: "conversation_1",
            runId: "run_1",
            sequence: 1,
            createdAt: now,
            updatedAt: now,
            type: "run",
            status: "cancelled",
            startedAt: now,
            finishedAt: now,
            stopReason: "cancelled",
          },
          {
            itemId: "run:run_2",
            sessionId: "conversation_1",
            runId: "run_2",
            sequence: 2,
            createdAt: now,
            updatedAt: now,
            type: "run",
            status: "started",
            startedAt: now,
          },
        ]}
      />,
    );

    expect(screen.queryByText("Task stopped")).not.toBeInTheDocument();
    expect(screen.getByText("Working on your design")).toBeInTheDocument();
  });

  it("sends with Enter, keeps Shift+Enter as a newline, and shows selection scope", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(true);
    window.desktop = {
      getModelProviderCatalog: vi.fn().mockResolvedValue({
        version: 3,
        providers: [
          {
            providerId: "provider_1",
            name: "Primary",
            enabled: true,
            apiFormat: "openai-responses",
            authMode: "bearer",
            baseUrl: "https://api.openai.com/v1",
            models: [
              {
                modelId: "design-model",
                name: "Design model",
                contextWindow: 200_000,
                maxOutputTokens: 16_384,
                capabilities: {
                  toolUse: true,
                  imageInput: false,
                  reasoning: false,
                },
                reasoningEfforts: ["off"],
              },
            ],
            hasApiKey: true,
            updatedAt: now,
          },
        ],
        defaultSelection: {
          providerId: "provider_1",
          modelId: "design-model",
          reasoningEffort: "off",
        },
      }),
      onModelProviderCatalogChange: vi.fn().mockReturnValue(() => undefined),
    } as unknown as DesktopApi;

    render(
      <AgentTimeline
        activeRunId={null}
        conversationId="conversation_1"
        conversationTitle="Conversation"
        error={null}
        events={[]}
        onStop={vi.fn()}
        onSubmit={onSubmit}
        scope={{ kind: "selection", count: 2 }}
        timeline={[]}
      />,
    );

    expect(
      screen.getByText("Context: Selection · 2 layer(s)"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "Agent write scope" }),
    ).not.toBeInTheDocument();
    const prompt = screen.getByLabelText("Continue the task");
    await user.type(prompt, "First line{Shift>}{Enter}{/Shift}Second line");
    expect(prompt).toHaveValue("First line\nSecond line");
    await user.type(prompt, "{Enter}");

    expect(onSubmit).toHaveBeenCalledWith(
      "First line\nSecond line",
      expect.objectContaining({ modelId: "design-model" }),
      [],
    );
    expect(
      screen.queryByText(/Requests include the current design/i),
    ).not.toBeInTheDocument();
  });

  it("requests one-time Page structure access for the active task", async () => {
    const user = userEvent.setup();
    const onResolveApproval = vi.fn().mockResolvedValue(true);
    const events: AgentEvent[] = [
      {
        type: "tool.requested",
        runId: "run_pages",
        toolCallId: "tool_pages",
        toolName: "opendesign_request_page_structure_access",
        input: {
          actions: ["create-page", "cross-page-edit"],
          reason: "Create the requested product suite.",
        },
        risk: "design_write",
      },
      {
        type: "approval.requested",
        runId: "run_pages",
        toolCallId: "tool_pages",
        approvalId: "approval_pages",
        title: "Allow Page structure changes",
        summary: "Allow this task to update Pages.",
      },
    ];
    const view = render(
      <AgentTimeline
        activeRunId="run_pages"
        approvalResourceName="Mobile Product"
        conversationId="conversation_1"
        conversationTitle="Product suite"
        error={null}
        events={events}
        onResolveApproval={onResolveApproval}
        onStop={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(true)}
        timeline={[]}
      />,
    );

    expect(
      screen.getByText("Modify Mobile Product Page structure?"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Access expires when the task ends/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Allow this task" }));
    expect(onResolveApproval).toHaveBeenCalledWith({
      runId: "run_pages",
      toolCallId: "tool_pages",
      approvalId: "approval_pages",
      decision: "allow_once",
    });
    expect(
      screen.getByRole("button", { name: "Allow this task" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Don’t allow" })).toBeDisabled();

    view.rerender(
      <AgentTimeline
        activeRunId="run_pages"
        approvalResourceName="Mobile Product"
        conversationId="conversation_1"
        conversationTitle="Product suite"
        error={null}
        events={[
          ...events,
          {
            type: "approval.resolved",
            runId: "run_pages",
            toolCallId: "tool_pages",
            approvalId: "approval_pages",
            decision: "allow_once",
            resolvedAt: now,
          },
        ]}
        onResolveApproval={onResolveApproval}
        onStop={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(true)}
        timeline={[]}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Allow this task" }),
    ).not.toBeInTheDocument();
  });

  it("shows the actual Delivery Plan with plan-specific confirmation actions", async () => {
    const user = userEvent.setup();
    const onResolveApproval = vi.fn().mockResolvedValue(true);
    render(
      <AgentTimeline
        activeRunId="run_scope"
        conversationId="conversation_1"
        conversationTitle="Product brief"
        error={null}
        events={[
          {
            type: "tool.requested",
            runId: "run_scope",
            toolCallId: "tool_scope",
            toolName: "opendesign_review_delivery_scope",
            input: {},
            risk: "read",
          },
          {
            type: "approval.requested",
            runId: "run_scope",
            toolCallId: "tool_scope",
            approvalId: "approval_scope",
            title: "Confirm delivery plan (2)",
            summary:
              "1. Login — Complete account entry\n2. Home — Present the core product entry",
          },
        ]}
        onResolveApproval={onResolveApproval}
        onStop={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(true)}
        timeline={[]}
      />,
    );

    expect(screen.getByText("Confirm delivery plan (2)")).toBeInTheDocument();
    expect(screen.getByText(/1\. Login/)).toBeInTheDocument();
    expect(screen.getByText(/2\. Home/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Revise plan" }));
    expect(onResolveApproval).toHaveBeenCalledWith({
      runId: "run_scope",
      toolCallId: "tool_scope",
      approvalId: "approval_scope",
      decision: "deny",
    });
  });

  it("can deny active Page access and never operates an old Run approval", async () => {
    const user = userEvent.setup();
    const onResolveApproval = vi.fn().mockResolvedValue(true);
    const approvalEvents: AgentEvent[] = [
      {
        type: "tool.requested",
        runId: "run_old",
        toolCallId: "tool_old_pages",
        toolName: "opendesign_request_page_structure_access",
        input: { actions: ["delete-page"], reason: "Delete an obsolete Page." },
        risk: "design_write",
      },
      {
        type: "approval.requested",
        runId: "run_old",
        toolCallId: "tool_old_pages",
        approvalId: "approval_old_pages",
        title: "Allow Page structure changes",
        summary: "Allow this task to update Pages.",
      },
    ];
    const view = render(
      <AgentTimeline
        activeRunId="run_current"
        approvalResourceName="Mobile Product"
        conversationId="conversation_1"
        conversationTitle="Product suite"
        error={null}
        events={approvalEvents}
        onResolveApproval={onResolveApproval}
        onStop={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(true)}
        timeline={[]}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Allow this task" }),
    ).not.toBeInTheDocument();

    view.rerender(
      <AgentTimeline
        activeRunId="run_current"
        approvalResourceName="Mobile Product"
        conversationId="conversation_1"
        conversationTitle="Product suite"
        error={null}
        events={approvalEvents.map((event) =>
          "runId" in event ? { ...event, runId: "run_current" } : event,
        )}
        onResolveApproval={onResolveApproval}
        onStop={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(true)}
        timeline={[]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Don’t allow" }));
    expect(onResolveApproval).toHaveBeenCalledWith({
      runId: "run_current",
      toolCallId: "tool_old_pages",
      approvalId: "approval_old_pages",
      decision: "deny",
    });
  });

  it("submits the conversation-selected Provider/Model and reasoning level", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(true);
    window.desktop = {
      getModelProviderCatalog: vi.fn().mockResolvedValue({
        version: 3,
        providers: [
          {
            providerId: "provider_1",
            name: "Primary",
            enabled: true,
            apiFormat: "openai-responses",
            authMode: "bearer",
            baseUrl: "https://api.openai.com/v1",
            models: [
              {
                modelId: "design-model",
                name: "Design model",
                contextWindow: 200_000,
                maxOutputTokens: 16_384,
                capabilities: {
                  toolUse: true,
                  imageInput: false,
                  reasoning: true,
                },
                reasoningEfforts: ["off", "medium", "high"],
              },
            ],
            hasApiKey: true,
            updatedAt: now,
          },
        ],
        defaultSelection: {
          providerId: "provider_1",
          modelId: "design-model",
          reasoningEffort: "medium",
        },
      }),
      onModelProviderCatalogChange: vi.fn().mockReturnValue(() => undefined),
    } as unknown as DesktopApi;

    render(
      <AgentTimeline
        activeRunId={null}
        conversationId="conversation_1"
        conversationTitle="Conversation"
        error={null}
        events={[]}
        onStop={vi.fn()}
        onSubmit={onSubmit}
        timeline={[]}
      />,
    );

    expect(
      await screen.findByRole("combobox", { name: "Model" }),
    ).toHaveTextContent("Primary/Design model");
    expect(
      screen.queryByRole("combobox", { name: "Generation depth" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Add attachments",
      }),
    ).toBeEnabled();
    await chooseNextOption(user, "Reasoning");
    await user.type(screen.getByLabelText("Continue the task"), "Refine it");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(onSubmit).toHaveBeenCalledWith(
      "Refine it",
      {
        providerId: "provider_1",
        modelId: "design-model",
        reasoningEffort: "high",
      },
      [],
    );
  });

  it("adds visible reference images and submits only safe attachment metadata", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(true);
    const attachmentId = `image_${"a".repeat(64)}`;
    window.desktop = {
      getModelProviderCatalog: vi.fn().mockResolvedValue({
        version: 3,
        providers: [
          {
            providerId: "provider_1",
            name: "Primary",
            enabled: true,
            apiFormat: "openai-responses",
            authMode: "bearer",
            baseUrl: "https://api.openai.com/v1",
            models: [
              {
                modelId: "vision-model",
                name: "Vision model",
                contextWindow: 200_000,
                maxOutputTokens: 16_384,
                capabilities: {
                  toolUse: true,
                  imageInput: true,
                  reasoning: false,
                },
                reasoningEfforts: ["off"],
              },
            ],
            hasApiKey: true,
            updatedAt: now,
          },
        ],
        defaultSelection: {
          providerId: "provider_1",
          modelId: "vision-model",
          reasoningEffort: "off",
        },
      }),
      onModelProviderCatalogChange: vi.fn().mockReturnValue(() => undefined),
      selectAgentAttachments: vi.fn().mockResolvedValue([
        {
          attachmentId,
          name: "inspiration.png",
          mimeType: "image/png",
          byteSize: 1024,
          previewDataUrl: "data:image/png;base64,aW1hZ2U=",
        },
      ]),
      getAgentAttachmentPreview: vi.fn(),
    } as unknown as DesktopApi;

    render(
      <AgentTimeline
        activeRunId={null}
        conversationId="conversation_1"
        conversationTitle="Conversation"
        error={null}
        events={[]}
        onStop={vi.fn()}
        onSubmit={onSubmit}
        timeline={[]}
      />,
    );

    await user.click(
      await screen.findByRole("button", { name: "Add attachments" }),
    );
    expect(
      await screen.findByRole("img", { name: "inspiration.png" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("1 attachment(s) will be sent to Vision model."),
    ).not.toBeInTheDocument();
    await user.type(
      screen.getByLabelText("Continue the task"),
      "Use this visual direction",
    );
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(onSubmit).toHaveBeenCalledWith(
      "Use this visual direction",
      {
        providerId: "provider_1",
        modelId: "vision-model",
        reasoningEffort: "off",
      },
      [
        {
          attachmentId,
          name: "inspiration.png",
          mimeType: "image/png",
          byteSize: 1024,
        },
      ],
    );
    expect(JSON.stringify(onSubmit.mock.calls)).not.toContain("base64");
  });

  it("submits a product document to a text-only model", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(true);
    const attachmentId = `file_${"b".repeat(64)}`;
    window.desktop = {
      getModelProviderCatalog: vi.fn().mockResolvedValue({
        version: 3,
        providers: [
          {
            providerId: "provider_1",
            name: "Primary",
            enabled: true,
            apiFormat: "openai-responses",
            authMode: "bearer",
            baseUrl: "https://api.openai.com/v1",
            models: [
              {
                modelId: "text-model",
                name: "Text model",
                contextWindow: 200_000,
                maxOutputTokens: 16_384,
                capabilities: {
                  toolUse: true,
                  imageInput: false,
                  reasoning: false,
                },
                reasoningEfforts: ["off"],
              },
            ],
            hasApiKey: true,
            updatedAt: now,
          },
        ],
        defaultSelection: {
          providerId: "provider_1",
          modelId: "text-model",
          reasoningEffort: "off",
        },
      }),
      onModelProviderCatalogChange: vi.fn().mockReturnValue(() => undefined),
      selectAgentAttachments: vi.fn().mockResolvedValue([
        {
          attachmentId,
          name: "product-brief.md",
          mimeType: "text/markdown",
          byteSize: 2048,
        },
      ]),
      getAgentAttachmentPreview: vi.fn(),
    } as unknown as DesktopApi;

    render(
      <AgentTimeline
        activeRunId={null}
        conversationId="conversation_1"
        conversationTitle="Conversation"
        error={null}
        events={[]}
        onStop={vi.fn()}
        onSubmit={onSubmit}
        timeline={[]}
      />,
    );

    await user.click(
      await screen.findByRole("button", { name: "Add attachments" }),
    );
    expect(screen.getByText("product-brief.md")).toBeInTheDocument();
    expect(screen.getByText("Markdown · 2 KB")).toBeInTheDocument();
    await user.type(
      screen.getByLabelText("Continue the task"),
      "Design the product described in this brief",
    );
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(onSubmit).toHaveBeenCalledWith(
      "Design the product described in this brief",
      {
        providerId: "provider_1",
        modelId: "text-model",
        reasoningEffort: "off",
      },
      [
        {
          attachmentId,
          name: "product-brief.md",
          mimeType: "text/markdown",
          byteSize: 2048,
        },
      ],
    );
  });

  it("submits an SVG handle to a text-only model for typed editable import", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(true);
    const attachmentId = `svg_${"e".repeat(64)}`;
    window.desktop = {
      getModelProviderCatalog: vi.fn().mockResolvedValue({
        version: 3,
        providers: [
          {
            providerId: "provider_1",
            name: "Primary",
            enabled: true,
            apiFormat: "openai-responses",
            authMode: "bearer",
            baseUrl: "https://api.openai.com/v1",
            models: [
              {
                modelId: "text-model",
                name: "Text model",
                contextWindow: 200_000,
                maxOutputTokens: 16_384,
                capabilities: {
                  toolUse: true,
                  imageInput: false,
                  reasoning: false,
                },
                reasoningEfforts: ["off"],
              },
            ],
            hasApiKey: true,
            updatedAt: now,
          },
        ],
        defaultSelection: {
          providerId: "provider_1",
          modelId: "text-model",
          reasoningEffort: "off",
        },
      }),
      onModelProviderCatalogChange: vi.fn().mockReturnValue(() => undefined),
      selectAgentAttachments: vi.fn().mockResolvedValue([
        {
          attachmentId,
          name: "brand-mark.svg",
          mimeType: "image/svg+xml",
          byteSize: 4096,
        },
      ]),
      getAgentAttachmentPreview: vi.fn(),
    } as unknown as DesktopApi;

    render(
      <AgentTimeline
        activeRunId={null}
        conversationId="conversation_1"
        conversationTitle="Conversation"
        error={null}
        events={[]}
        onStop={vi.fn()}
        onSubmit={onSubmit}
        timeline={[]}
      />,
    );

    await user.click(
      await screen.findByRole("button", { name: "Add attachments" }),
    );
    expect(screen.getByText("brand-mark.svg")).toBeInTheDocument();
    expect(screen.getByText("SVG · 4 KB")).toBeInTheDocument();
    await user.type(
      screen.getByLabelText("Continue the task"),
      "Import this as editable vectors",
    );
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(onSubmit).toHaveBeenCalledWith(
      "Import this as editable vectors",
      {
        providerId: "provider_1",
        modelId: "text-model",
        reasoningEffort: "off",
      },
      [
        {
          attachmentId,
          name: "brand-mark.svg",
          mimeType: "image/svg+xml",
          byteSize: 4096,
        },
      ],
    );
  });

  it("imports pasted and dropped files but submits only safe attachment metadata", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(true);
    const pastedId = `image_${"c".repeat(64)}`;
    const droppedId = `file_${"d".repeat(64)}`;
    const pastedBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const droppedBytes = new TextEncoder().encode("# Product brief");
    const pastedFile = new File([pastedBytes], "pasted.png", {
      type: "image/png",
    });
    const droppedFile = new File([droppedBytes], "brief.md", {
      type: "text/markdown",
    });
    Object.defineProperty(pastedFile, "arrayBuffer", {
      value: vi.fn().mockResolvedValue(pastedBytes.buffer),
    });
    Object.defineProperty(droppedFile, "arrayBuffer", {
      value: vi.fn().mockResolvedValue(droppedBytes.buffer),
    });
    const importAgentAttachments = vi
      .fn<DesktopApi["importAgentAttachments"]>()
      .mockImplementation(([attachment]) => {
        if (attachment?.name === "pasted.png") {
          return Promise.resolve([
            {
              attachmentId: pastedId,
              name: "pasted.png",
              mimeType: "image/png",
              byteSize: pastedBytes.byteLength,
              previewDataUrl: "data:image/png;base64,iVBORw==",
            },
          ]);
        }
        return Promise.resolve([
          {
            attachmentId: droppedId,
            name: "brief.md",
            mimeType: "text/markdown",
            byteSize: droppedBytes.byteLength,
          },
        ]);
      });
    window.desktop = {
      getModelProviderCatalog: vi.fn().mockResolvedValue({
        version: 3,
        providers: [
          {
            providerId: "provider_1",
            name: "Primary",
            enabled: true,
            apiFormat: "openai-responses",
            authMode: "bearer",
            baseUrl: "https://api.openai.com/v1",
            models: [
              {
                modelId: "vision-model",
                name: "Vision model",
                contextWindow: 200_000,
                maxOutputTokens: 16_384,
                capabilities: {
                  toolUse: true,
                  imageInput: true,
                  reasoning: false,
                },
                reasoningEfforts: ["off"],
              },
            ],
            hasApiKey: true,
            updatedAt: now,
          },
        ],
        defaultSelection: {
          providerId: "provider_1",
          modelId: "vision-model",
          reasoningEffort: "off",
        },
      }),
      onModelProviderCatalogChange: vi.fn().mockReturnValue(() => undefined),
      importAgentAttachments,
      getAgentAttachmentPreview: vi.fn(),
    } as unknown as DesktopApi;

    render(
      <AgentTimeline
        activeRunId={null}
        conversationId="conversation_1"
        conversationTitle="Conversation"
        error={null}
        events={[]}
        onStop={vi.fn()}
        onSubmit={onSubmit}
        timeline={[]}
      />,
    );

    const prompt = screen.getByLabelText("Continue the task");
    fireEvent.paste(prompt, { clipboardData: { files: [pastedFile] } });
    expect(
      await screen.findByRole("img", { name: "pasted.png" }),
    ).toBeInTheDocument();
    expect(importAgentAttachments).toHaveBeenNthCalledWith(1, [
      { name: "pasted.png", bytes: pastedBytes },
    ]);

    const dropTarget = prompt.closest("[data-agent-prompt-editor]");
    expect(dropTarget).not.toBeNull();
    fireEvent.drop(dropTarget!, {
      dataTransfer: { files: [droppedFile], types: ["Files"] },
    });
    expect(await screen.findByText("brief.md")).toBeInTheDocument();
    expect(importAgentAttachments).toHaveBeenNthCalledWith(2, [
      { name: "brief.md", bytes: droppedBytes },
    ]);

    const plainPathPaste = new Event("paste", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(plainPathPaste, "clipboardData", {
      value: {
        files: [],
        getData: () => "C:\\Users\\designer\\reference.png",
      },
    });
    fireEvent(prompt, plainPathPaste);
    expect(plainPathPaste.defaultPrevented).toBe(false);
    expect(importAgentAttachments).toHaveBeenCalledTimes(2);

    await user.type(prompt, "Use both references");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(onSubmit).toHaveBeenCalledWith(
      "Use both references",
      {
        providerId: "provider_1",
        modelId: "vision-model",
        reasoningEffort: "off",
      },
      [
        {
          attachmentId: pastedId,
          name: "pasted.png",
          mimeType: "image/png",
          byteSize: pastedBytes.byteLength,
        },
        {
          attachmentId: droppedId,
          name: "brief.md",
          mimeType: "text/markdown",
          byteSize: droppedBytes.byteLength,
        },
      ],
    );
    const submittedAttachments = (onSubmit.mock.calls[0]?.[2] ??
      []) as AgentAttachment[];
    expect(
      submittedAttachments.every((attachment) =>
        Object.keys(attachment).every((key) =>
          ["attachmentId", "name", "mimeType", "byteSize"].includes(key),
        ),
      ),
    ).toBe(true);
  });

  it("follows new activity only while the reader remains near the bottom", () => {
    window.desktop = {
      getModelProviderCatalog: vi.fn().mockResolvedValue({
        version: 3,
        providers: [],
      }),
      onModelProviderCatalogChange: vi.fn().mockReturnValue(() => undefined),
    } as unknown as DesktopApi;
    const message = (
      sequence: number,
      content: string,
    ): SessionTimelineItem => ({
      itemId: `message:user_${sequence}`,
      sessionId: "conversation_1",
      runId: `run_${sequence}`,
      sequence,
      createdAt: now,
      updatedAt: now,
      type: "user.message",
      messageId: `user_${sequence}`,
      content,
      documentId: "document_1",
      revision: 0,
      scope: { kind: "page", pageId: "page_1", selectedNodeIds: [] },
      mutationTarget: { kind: "page", pageId: "page_1" },
    });
    const renderTimeline = (timeline: SessionTimelineItem[]) => (
      <AgentTimeline
        activeRunId={null}
        conversationId="conversation_1"
        conversationTitle="Conversation"
        error={null}
        events={[]}
        onStop={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(true)}
        timeline={timeline}
      />
    );
    const { rerender } = render(renderTimeline([message(1, "First")]));
    const thread = screen.getByRole("list");
    let scrollHeight = 400;
    Object.defineProperties(thread, {
      clientHeight: { configurable: true, get: () => 100 },
      scrollHeight: { configurable: true, get: () => scrollHeight },
    });

    rerender(renderTimeline([message(1, "First"), message(2, "Second")]));
    expect(thread.scrollTop).toBe(400);

    thread.scrollTop = 100;
    fireEvent.scroll(thread);
    scrollHeight = 500;
    rerender(
      renderTimeline([
        message(1, "First"),
        message(2, "Second"),
        message(3, "Third"),
      ]),
    );
    expect(thread.scrollTop).toBe(100);

    thread.scrollTop = 400;
    fireEvent.scroll(thread);
    scrollHeight = 700;
    rerender(
      renderTimeline([
        message(1, "First"),
        message(2, "Second"),
        message(3, "Third"),
        message(4, "Fourth"),
      ]),
    );
    expect(thread.scrollTop).toBe(700);
  });
});
