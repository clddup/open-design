import { DropdownMenu, DropdownMenuItem, Icon } from "@opendesign/ui";
import { useI18n } from "../../../i18n";
import styles from "./ConversationActions.module.scss";

export type ConversationActionsProps = {
  conversationId: string;
  deleteBlocked: boolean;
  disabled?: boolean;
  onRequestDelete: (conversationId: string) => void;
  title?: string;
};

export function ConversationActions({
  conversationId,
  deleteBlocked,
  disabled = false,
  onRequestDelete,
  title,
}: ConversationActionsProps) {
  const { t } = useI18n();
  return (
    <DropdownMenu
      disabled={disabled}
      icon={<Icon name="lucide:ellipsis" size={14} />}
      label={
        title
          ? t("workspace.conversationActions", { title })
          : t("agent.conversationActions")
      }
    >
      <DropdownMenuItem
        className={styles.deleteAction}
        disabled={deleteBlocked}
        onSelect={() => onRequestDelete(conversationId)}
      >
        {deleteBlocked
          ? t("workspace.stopTaskBeforeDelete")
          : t("workspace.deleteConversation")}
      </DropdownMenuItem>
    </DropdownMenu>
  );
}
