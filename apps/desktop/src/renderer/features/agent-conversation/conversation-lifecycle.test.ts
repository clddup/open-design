import { act, renderHook, waitFor } from "@testing-library/react";
import type { ConversationDescriptor } from "@opendesign/workspace-contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopApi } from "../../../shared/desktop-api";
import { useConversationLifecycleState } from "./use-conversation-lifecycle-state";
import { useConversationNavigationController } from "./use-conversation-navigation-controller";

const conversation: ConversationDescriptor = {
  conversationId: "conversation_1",
  originProjectId: "project_1",
  filedProjectId: "project_1",
  title: "Homepage",
  lifecycle: "active",
  createdAt: "2026-08-23T00:00:00.000Z",
  updatedAt: "2026-08-23T00:00:00.000Z",
};

afterEach(() => {
  delete window.desktop;
});

describe("conversation lifecycle", () => {
  it("loads Workspace conversations into one feature-owned state", async () => {
    window.desktop = {
      listConversations: vi.fn().mockResolvedValue([conversation]),
    } as unknown as DesktopApi;
    const setWorkspaceError = vi.fn();
    const { result } = renderHook(() =>
      useConversationLifecycleState({
        setWorkspaceError,
        t: (key) => key,
      }),
    );

    await waitFor(() => expect(result.current.conversations).toHaveLength(1));
    act(() => result.current.selectConversation(conversation.conversationId));

    expect(result.current.activeConversation).toEqual(conversation);
    expect(setWorkspaceError).not.toHaveBeenCalled();
  });

  it("opens unavailable targets as readable Conversation history without entering the editor", async () => {
    window.desktop = {
      resolveConversationOpenContext: vi.fn().mockResolvedValue({
        kind: "target-unavailable",
        conversationId: conversation.conversationId,
        reason: "design-file-unavailable",
      }),
    } as unknown as DesktopApi;
    const requestConversationHistory = vi.fn().mockResolvedValue(undefined);
    const selectConversation = vi.fn();
    const setConversationOpenIssue = vi.fn();
    const showView = vi.fn();
    const openProjectTarget = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useConversationNavigationController({
        activeConversationId: null,
        activeProject: null,
        conversations: [conversation],
        forgetConversation: vi.fn(),
        openProjectTarget,
        refreshRecentProjects: vi.fn().mockResolvedValue(undefined),
        requestConversationHistory,
        selectConversation,
        setConversationDeletionBusy: vi.fn(),
        setConversationDeletionError: vi.fn(),
        setConversationOpenIssue,
        setConversations: vi.fn(),
        setPendingConversationDeletionId: vi.fn(),
        setWorkspaceBusy: vi.fn(),
        setWorkspaceError: vi.fn(),
        showView,
        t: (key) => key,
        view: "workspace",
      }),
    );

    await act(() => result.current.openConversation(conversation));

    expect(selectConversation).toHaveBeenCalledWith(
      conversation.conversationId,
    );
    expect(requestConversationHistory).toHaveBeenCalledWith(
      conversation.conversationId,
    );
    expect(setConversationOpenIssue).toHaveBeenCalledWith(
      "design-file-unavailable",
    );
    expect(showView).toHaveBeenCalledWith("conversation");
    expect(openProjectTarget).not.toHaveBeenCalled();
  });

  it("forgets runtime state only after durable deletion succeeds", async () => {
    window.desktop = {
      deleteConversation: vi.fn().mockResolvedValue(true),
    } as unknown as DesktopApi;
    const forgetConversation = vi.fn();
    const selectConversation = vi.fn();
    const setConversations = vi.fn();
    const setPendingConversationDeletionId = vi.fn();
    const { result } = renderHook(() =>
      useConversationNavigationController({
        activeConversationId: conversation.conversationId,
        activeProject: null,
        conversations: [conversation],
        forgetConversation,
        openProjectTarget: vi.fn().mockResolvedValue(undefined),
        refreshRecentProjects: vi.fn().mockResolvedValue(undefined),
        requestConversationHistory: vi.fn().mockResolvedValue(undefined),
        selectConversation,
        setConversationDeletionBusy: vi.fn(),
        setConversationDeletionError: vi.fn(),
        setConversationOpenIssue: vi.fn(),
        setConversations,
        setPendingConversationDeletionId,
        setWorkspaceBusy: vi.fn(),
        setWorkspaceError: vi.fn(),
        showView: vi.fn(),
        t: (key) => key,
        view: "workspace",
      }),
    );

    await act(() =>
      result.current.deleteConversation(conversation.conversationId),
    );

    expect(forgetConversation).toHaveBeenCalledWith(
      conversation.conversationId,
    );
    expect(selectConversation).toHaveBeenCalledWith(null);
    expect(setConversations).toHaveBeenCalledOnce();
    expect(setPendingConversationDeletionId).toHaveBeenCalledWith(null);
  });
});
