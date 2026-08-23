import type { ConversationDescriptor } from "@opendesign/workspace-contracts";
import { ConfirmDialog, Icon } from "@opendesign/ui";
import { useI18n } from "../../../i18n";

export type ConversationDeleteDialogProps = {
  busy: boolean;
  conversation: ConversationDescriptor | null;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConversationDeleteDialog({
  busy,
  conversation,
  error,
  onCancel,
  onConfirm,
}: ConversationDeleteDialogProps) {
  const { t } = useI18n();

  return (
    <ConfirmDialog
      busy={busy}
      cancelLabel={t("common.cancel")}
      confirmLabel={
        busy
          ? t("workspace.deletingConversation")
          : t("workspace.confirmDelete")
      }
      description={t("workspace.deleteConversationDescription")}
      error={error}
      icon={<Icon name="lucide:trash-2" size={16} />}
      onConfirm={onConfirm}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      open={conversation !== null}
      title={
        conversation
          ? t("workspace.confirmDeleteConversation", {
              title: conversation.title,
            })
          : ""
      }
    />
  );
}
