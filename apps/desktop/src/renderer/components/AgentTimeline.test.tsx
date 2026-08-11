import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  AgentAttachment,
  AgentEvent,
  SessionTimelineItem,
} from "@opendesign/agent-contracts";
import { describe, expect, it, vi } from "vitest";
import type { DesktopApi } from "../../shared/desktop-api";
import { AgentTimeline } from "./AgentTimeline";

const now = "2026-08-08T12:00:00.000Z";

async function chooseNextOption(
  user: ReturnType<typeof userEvent.setup>,
  selectName: string,
) {
  screen.getByRole("combobox", { name: selectName }).focus();
  await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
}

describe("AgentTimeline", () => {
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
        sequence: 2,
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

    expect(container.querySelectorAll(".agent-thread__item")).toHaveLength(2);
    expect(screen.queryByText("Task completed")).not.toBeInTheDocument();
    expect(screen.queryByText("Agent response")).not.toBeInTheDocument();
    expect(screen.getAllByText("Design change completed")).toHaveLength(1);
    expect(screen.getByText("Durable response")).toBeInTheDocument();
    expect(screen.queryByText("Live response")).not.toBeInTheDocument();
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
      [...container.querySelectorAll(".agent-message p")].map(
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

    expect(container.querySelectorAll(".agent-message p")[1]).toHaveTextContent(
      "Complete opening paragraph. - First point - Final point",
    );
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

    expect(container.querySelectorAll(".agent-thread__item")).toHaveLength(1);
    expect(screen.getByText("Canvas updated")).toBeInTheDocument();
    expect(
      screen.queryByText("Working on your design"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Task completed")).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent("opendesign_apply_transaction");
    expect(container).not.toHaveTextContent("transaction_canvas_1");
    expect(container).not.toHaveTextContent("run_canvas_1");
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

    expect(container.querySelectorAll(".agent-thread__item")).toHaveLength(1);
    expect(
      screen.getByText("The model response was interrupted. Try again."),
    ).toBeInTheDocument();
    expect(container).not.toHaveTextContent("run_internal_1");
    expect(container).not.toHaveTextContent("attempt_1");
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
    expect(failedMessage).toHaveClass("agent-thread__item--done");
    expect(failedMessage).not.toHaveClass("agent-thread__item--active");
    expect(currentMessage).toHaveClass("agent-thread__item--active");
    expect(container.querySelectorAll(".agent-message__caret")).toHaveLength(1);
    expect(
      currentMessage?.querySelector(".agent-message__caret"),
    ).not.toBeNull();
  });

  it("hides reasoning summaries and native tool plumbing from durable history", () => {
    const timeline: SessionTimelineItem[] = [
      {
        itemId: "message:reasoning_only",
        sessionId: "conversation_1",
        runId: "run_history_1",
        sequence: 1,
        createdAt: now,
        updatedAt: now,
        type: "assistant.message",
        messageId: "reasoning_only",
        blocks: [
          {
            blockId: "reasoning_block_1",
            type: "reasoning_summary",
            status: "completed",
            summary: "**Planning internal transaction sequencing**",
          },
        ],
      },
      {
        itemId: "tool:durable_canvas_tool",
        sessionId: "conversation_1",
        runId: "run_history_1",
        sequence: 2,
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
    expect(container).not.toHaveTextContent("Planning internal");
    expect(container).not.toHaveTextContent("revision");
    expect(container).not.toHaveTextContent("Response completed");
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

  it("turns canvas scope internals into a recoverable tool error", () => {
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

    expect(
      screen.getByText(
        "This change did not match the active canvas scope. The Agent can inspect the canvas and try again.",
      ),
    ).toBeInTheDocument();
    expect(container).not.toHaveTextContent("login-002");
    expect(container).not.toHaveTextContent("registered page scope");
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
            homeProjectId: "project_1",
            title: "Conversation 1",
            lifecycle: "active",
            createdAt: now,
            updatedAt: now,
          },
          {
            conversationId: "conversation_2",
            homeProjectId: "project_1",
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
        ".agent-thread__item--assistant.agent-thread__item--active",
      ),
    ).toBeInTheDocument();
    const caret = container.querySelector(".agent-message__caret");
    expect(caret).toBeInTheDocument();
    expect(caret?.parentElement?.tagName).toBe("P");
    await user.click(screen.getByRole("button", { name: "Stop" }));
    expect(onStop).toHaveBeenCalledOnce();
    expect(screen.getByText("Stopping request")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stopping…" })).toBeDisabled();
    expect(
      container.querySelector(
        ".agent-thread__item--assistant.agent-thread__item--active",
      ),
    ).not.toBeInTheDocument();
    expect(
      container.querySelector(
        ".agent-thread__item--assistant.agent-thread__item--stopping",
      ),
    ).toBeInTheDocument();
    expect(container.querySelector(".agent-message__caret")).toBeNull();
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
        ".agent-thread__item--assistant.agent-thread__item--active",
      ),
    ).not.toBeInTheDocument();
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

    expect(screen.getByText("Selection · 2 layer(s)")).toBeInTheDocument();
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

    const dropTarget = prompt.closest(".agent-prompt__editor");
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
