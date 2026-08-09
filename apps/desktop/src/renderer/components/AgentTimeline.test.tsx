import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
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
    expect(screen.getByText("Live response")).toBeInTheDocument();
    expect(screen.queryByText("Durable response")).not.toBeInTheDocument();
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

  it("sends with Enter, keeps Shift+Enter as a newline, and shows selection scope", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(true);
    window.desktop = {
      getModelProviderCatalog: vi.fn().mockResolvedValue({
        version: 1,
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
        version: 1,
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
        version: 1,
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
        version: 1,
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
});
