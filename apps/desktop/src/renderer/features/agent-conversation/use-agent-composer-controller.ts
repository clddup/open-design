import {
  MAX_AGENT_ATTACHMENTS,
  type AgentAttachment,
  type SessionTimelineItem,
} from "@opendesign/agent-contracts";
import type { ModelSelection } from "@opendesign/model-gateway";
import { useEffect, useRef, useState } from "react";
import type {
  AgentAttachmentSelection,
  ModelProviderCatalog,
} from "@/shared/desktop-api";
import { isImageAttachment, toAgentAttachment } from "./attachment-format";
import {
  firstValidSelection,
  resolveCatalogModel,
  selectableModels,
  type ComposerModelOption,
} from "./composer-models";
import type { Translate } from "./timeline-types";

export interface AgentComposerControllerOptions {
  activeRunId: string | null;
  conversationId: string | null;
  conversationTitle: string | null;
  onCreateConversation?: () => Promise<boolean>;
  onStop: () => boolean | void | Promise<boolean | void>;
  onSubmit: (
    prompt: string,
    selection: ModelSelection,
    attachments: readonly AgentAttachment[],
  ) => Promise<boolean>;
  timeline: readonly SessionTimelineItem[];
  t: Translate;
  submissionAvailable?: boolean;
}

export interface AgentComposerController {
  attachmentDropActive: boolean;
  attachments: readonly AgentAttachmentSelection[];
  canSubmit: boolean;
  catalogError: string | null;
  creatingConversation: boolean;
  hasConversation: boolean;
  hasImageAttachments: boolean;
  importAttachmentFiles: (files: readonly File[]) => Promise<void>;
  modelOptions: readonly ComposerModelOption[];
  modelSelection: ModelSelection | null;
  prompt: string;
  removeAttachment: (attachmentId: string) => void;
  selectAttachments: () => Promise<void>;
  selectedModelName: string | null;
  selectedModelReasoningEfforts: readonly NonNullable<
    ModelSelection["reasoningEffort"]
  >[];
  selectingAttachments: boolean;
  setAttachmentDropActive: (active: boolean) => void;
  setModelSelection: (selection: ModelSelection) => void;
  setPrompt: (prompt: string) => void;
  stop: () => Promise<void>;
  stopping: boolean;
  submit: () => Promise<boolean>;
  submitting: boolean;
  supportsImageInput: boolean;
  submissionAvailable: boolean;
  attachmentError: string | null;
  createConversation: () => Promise<void>;
}

export function useAgentComposerController({
  activeRunId,
  conversationId,
  conversationTitle,
  onCreateConversation,
  onStop,
  onSubmit,
  timeline,
  t,
  submissionAvailable = true,
}: AgentComposerControllerOptions): AgentComposerController {
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [creatingConversation, setCreatingConversation] = useState(false);
  const [selectingAttachments, setSelectingAttachments] = useState(false);
  const [attachments, setAttachments] = useState<AgentAttachmentSelection[]>(
    [],
  );
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [attachmentDropActive, setAttachmentDropActive] = useState(false);
  const [stopRequest, setStopRequest] = useState<{
    conversationId: string | null;
    runId: string;
  } | null>(null);
  const [catalog, setCatalog] = useState<ModelProviderCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [modelSelection, setModelSelectionState] =
    useState<ModelSelection | null>(null);
  const initializedConversation = useRef<string | null>(null);
  const conversationEpoch = useRef(0);
  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  const stopping =
    activeRunId !== null && stopRequest?.conversationId === conversationId;
  const hasConversation = conversationTitle !== null;

  useEffect(() => {
    if (!activeRunId) {
      setStopRequest(null);
      return;
    }
    if (
      stopRequest?.conversationId === conversationId &&
      stopRequest.runId !== activeRunId
    ) {
      // A Main-owned continuation may replace the active Run between the
      // user's click and the cancellation terminal. Stop applies to that
      // recovery chain, so keep the composer in stopping state for its child.
      setStopRequest({ conversationId, runId: activeRunId });
    }
  }, [activeRunId, conversationId, stopRequest]);

  useEffect(() => {
    let active = true;
    const desktop = window.desktop;
    if (!desktop || typeof desktop.getModelProviderCatalog !== "function") {
      setCatalogError(t("agent.modelCatalogUnavailable"));
      return;
    }
    const unsubscribe =
      typeof desktop.onModelProviderCatalogChange === "function"
        ? desktop.onModelProviderCatalogChange((nextCatalog) => {
            if (!active) return;
            setCatalog(nextCatalog);
            setCatalogError(null);
          })
        : undefined;
    void desktop
      .getModelProviderCatalog()
      .then((nextCatalog) => {
        if (!active) return;
        setCatalog(nextCatalog);
        setCatalogError(null);
      })
      .catch((loadError: unknown) => {
        if (!active) return;
        setCatalogError(
          loadError instanceof Error
            ? loadError.message
            : t("agent.modelCatalogFailed"),
        );
      });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [t]);

  useEffect(() => {
    if (!catalog) return;
    const conversationChanged =
      initializedConversation.current !== conversationId;
    const remembered = [...timeline]
      .reverse()
      .find(
        (item): item is Extract<SessionTimelineItem, { type: "run" }> =>
          item.type === "run" && item.modelSelection !== undefined,
      )?.modelSelection;
    if (
      conversationChanged ||
      modelSelection === null ||
      !resolveCatalogModel(catalog, modelSelection)
    ) {
      setModelSelectionState(
        firstValidSelection(catalog, remembered ?? catalog.defaultSelection),
      );
      initializedConversation.current = conversationId;
    }
  }, [catalog, conversationId, modelSelection, timeline]);

  useEffect(() => {
    conversationEpoch.current += 1;
    setPrompt("");
    setAttachments([]);
    setAttachmentError(null);
    setAttachmentDropActive(false);
    setSelectingAttachments(false);
    setSubmitting(false);
    setStopRequest(null);
  }, [conversationId]);

  const selectedCatalogModel =
    catalog && modelSelection
      ? resolveCatalogModel(catalog, modelSelection)
      : undefined;
  const modelOptions = catalog ? selectableModels(catalog) : [];
  const supportsImageInput = Boolean(
    selectedCatalogModel?.model.capabilities.imageInput,
  );
  const hasImageAttachments = attachments.some(isImageAttachment);
  const canSubmit = Boolean(
    hasConversation &&
    submissionAvailable &&
    modelSelection &&
    prompt.trim() &&
    !(hasImageAttachments && !supportsImageInput) &&
    !submitting &&
    !activeRunId,
  );

  const submit = async (): Promise<boolean> => {
    const value = prompt.trim();
    const selection = modelSelection;
    if (!canSubmit || !selection) return false;
    const epoch = conversationEpoch.current;
    const targetConversationId = conversationId;
    setSubmitting(true);
    try {
      const accepted = await onSubmit(
        value,
        selection,
        attachments.map(toAgentAttachment),
      );
      if (accepted && isCurrentConversation(epoch, targetConversationId)) {
        setPrompt("");
        setAttachments([]);
        setAttachmentError(null);
      }
      return accepted;
    } finally {
      if (isCurrentConversation(epoch, targetConversationId)) {
        setSubmitting(false);
      }
    }
  };

  const selectAttachments = async (): Promise<void> => {
    const desktop = window.desktop;
    if (
      selectingAttachments ||
      !desktop ||
      typeof desktop.selectAgentAttachments !== "function"
    ) {
      return;
    }
    const epoch = conversationEpoch.current;
    const targetConversationId = conversationId;
    setSelectingAttachments(true);
    setAttachmentError(null);
    try {
      const selected = await desktop.selectAgentAttachments();
      if (!isCurrentConversation(epoch, targetConversationId)) {
        return;
      }
      setAttachments((current) => mergeAttachments(current, selected));
    } catch (selectionError) {
      if (!isCurrentConversation(epoch, targetConversationId)) return;
      setAttachmentError(
        selectionError instanceof Error
          ? selectionError.message
          : t("agent.attachmentSelectionFailed"),
      );
    } finally {
      if (isCurrentConversation(epoch, targetConversationId)) {
        setSelectingAttachments(false);
      }
    }
  };

  const importAttachmentFiles = async (
    files: readonly File[],
  ): Promise<void> => {
    const desktop = window.desktop;
    if (
      files.length === 0 ||
      !desktop ||
      typeof desktop.importAgentAttachments !== "function"
    ) {
      return;
    }
    const epoch = conversationEpoch.current;
    const targetConversationId = conversationId;
    setSelectingAttachments(true);
    setAttachmentError(null);
    try {
      const available = Math.max(
        0,
        MAX_AGENT_ATTACHMENTS - attachmentsRef.current.length,
      );
      const imports = await Promise.all(
        files.slice(0, available).map(async (file, index) => ({
          name:
            file.name ||
            `clipboard-image-${Date.now()}-${index + 1}.${file.type.split("/")[1] || "png"}`,
          bytes: new Uint8Array(await file.arrayBuffer()),
        })),
      );
      const selected = await desktop.importAgentAttachments(imports);
      if (!isCurrentConversation(epoch, targetConversationId)) {
        return;
      }
      setAttachments((current) => mergeAttachments(current, selected));
    } catch (importError) {
      if (!isCurrentConversation(epoch, targetConversationId)) return;
      setAttachmentError(
        importError instanceof Error
          ? importError.message
          : t("agent.attachmentImportFailed"),
      );
    } finally {
      if (isCurrentConversation(epoch, targetConversationId)) {
        setSelectingAttachments(false);
        setAttachmentDropActive(false);
      }
    }
  };

  const createConversation = async (): Promise<void> => {
    if (!onCreateConversation || creatingConversation || activeRunId) return;
    setCreatingConversation(true);
    try {
      await onCreateConversation();
    } finally {
      setCreatingConversation(false);
    }
  };

  const stop = async (): Promise<void> => {
    if (!activeRunId || stopping) return;
    const runId = activeRunId;
    setStopRequest({ conversationId, runId });
    try {
      if ((await onStop()) === false) {
        setStopRequest((current) =>
          current?.runId === runId && current.conversationId === conversationId
            ? null
            : current,
        );
      }
    } catch {
      setStopRequest((current) =>
        current?.runId === runId && current.conversationId === conversationId
          ? null
          : current,
      );
    }
  };

  const isCurrentConversation = (
    epoch: number,
    targetConversationId: string | null,
  ): boolean =>
    epoch === conversationEpoch.current &&
    targetConversationId === conversationIdRef.current;

  return {
    attachmentDropActive,
    attachmentError,
    attachments,
    canSubmit,
    catalogError,
    createConversation,
    creatingConversation,
    hasConversation,
    hasImageAttachments,
    importAttachmentFiles,
    modelOptions,
    modelSelection,
    prompt,
    removeAttachment: (attachmentId) =>
      setAttachments((current) =>
        current.filter(
          (attachment) => attachment.attachmentId !== attachmentId,
        ),
      ),
    selectAttachments,
    selectedModelName: selectedCatalogModel?.model.name ?? null,
    selectedModelReasoningEfforts:
      selectedCatalogModel?.model.reasoningEfforts ?? [],
    selectingAttachments,
    setAttachmentDropActive,
    setModelSelection: setModelSelectionState,
    setPrompt,
    stop,
    stopping,
    submit,
    submitting,
    supportsImageInput,
    submissionAvailable,
  };
}

function mergeAttachments(
  current: readonly AgentAttachmentSelection[],
  selected: readonly AgentAttachmentSelection[],
): AgentAttachmentSelection[] {
  const merged = new Map(
    current.map((attachment) => [attachment.attachmentId, attachment]),
  );
  for (const attachment of selected) {
    merged.set(attachment.attachmentId, attachment);
  }
  return [...merged.values()].slice(0, MAX_AGENT_ATTACHMENTS);
}
