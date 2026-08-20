import { Toast } from "@base-ui/react/toast";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
} from "react";
import { Icon, type IconName } from "../icons/Icon";
import styles from "./Message.module.scss";

export type AppMessageKey = string | number;
export type AppMessageType =
  "success" | "info" | "warning" | "error" | "loading";

export interface AppMessageOptions {
  content: ReactNode;
  dismissible?: boolean;
  durationMs?: number;
  key?: AppMessageKey;
  onClose?: () => void;
  type?: AppMessageType;
}

export interface AppMessageHandle {
  dismiss: () => void;
  key: AppMessageKey;
}

type MessageShortcutOptions = Omit<AppMessageOptions, "content" | "type">;

export interface AppMessageApi {
  clear: () => void;
  dismiss: (key: AppMessageKey) => void;
  error: (
    content: ReactNode,
    options?: MessageShortcutOptions,
  ) => AppMessageHandle;
  info: (
    content: ReactNode,
    options?: MessageShortcutOptions,
  ) => AppMessageHandle;
  loading: (
    content: ReactNode,
    options?: MessageShortcutOptions,
  ) => AppMessageHandle;
  open: (options: AppMessageOptions) => AppMessageHandle;
  success: (
    content: ReactNode,
    options?: MessageShortcutOptions,
  ) => AppMessageHandle;
  warning: (
    content: ReactNode,
    options?: MessageShortcutOptions,
  ) => AppMessageHandle;
}

interface MessageData {
  dismissible: boolean;
}

const MessageContext = createContext<AppMessageApi | null>(null);

const DEFAULT_DURATION: Record<AppMessageType, number> = {
  success: 2_600,
  info: 3_000,
  warning: 4_500,
  error: 5_500,
  loading: 0,
};

const MESSAGE_ICON: Record<AppMessageType, IconName> = {
  success: "lucide:circle-check",
  info: "lucide:info",
  warning: "lucide:triangle-alert",
  error: "lucide:circle-alert",
  loading: "lucide:loader-circle",
};

export function MessageProvider({
  children,
  dismissLabel = "Dismiss message",
  maxCount = 3,
  regionLabel = "Messages",
}: {
  children: ReactNode;
  dismissLabel?: string;
  maxCount?: number;
  regionLabel?: string;
}) {
  return (
    <Toast.Provider limit={maxCount} timeout={3_000}>
      <MessageApiProvider dismissLabel={dismissLabel} regionLabel={regionLabel}>
        {children}
      </MessageApiProvider>
    </Toast.Provider>
  );
}

export function useMessage(): AppMessageApi {
  const api = useContext(MessageContext);
  if (!api) throw new Error("useMessage must be used inside MessageProvider");
  return api;
}

function MessageApiProvider({
  children,
  dismissLabel,
  regionLabel,
}: {
  children: ReactNode;
  dismissLabel: string;
  regionLabel: string;
}) {
  const manager = Toast.useToastManager<MessageData>();
  const sequence = useRef(0);

  const dismiss = useCallback(
    (key: AppMessageKey) => manager.close(toastId(key)),
    [manager],
  );
  const clear = useCallback(() => manager.close(), [manager]);
  const open = useCallback(
    (options: AppMessageOptions): AppMessageHandle => {
      const type = options.type ?? "info";
      const key = options.key ?? `message_${++sequence.current}`;
      const id = toastId(key);
      manager.add({
        data: {
          dismissible:
            options.dismissible ?? (type === "warning" || type === "error"),
        },
        id,
        ...(options.onClose ? { onClose: options.onClose } : {}),
        priority: type === "error" ? "high" : "low",
        timeout: options.durationMs ?? DEFAULT_DURATION[type],
        title: options.content,
        type,
      });
      return { key, dismiss: () => manager.close(id) };
    },
    [manager],
  );

  const api = useMemo<AppMessageApi>(() => {
    const shortcut =
      (type: AppMessageType) =>
      (content: ReactNode, options: MessageShortcutOptions = {}) =>
        open({ ...options, content, type });
    return {
      clear,
      dismiss,
      error: shortcut("error"),
      info: shortcut("info"),
      loading: shortcut("loading"),
      open,
      success: shortcut("success"),
      warning: shortcut("warning"),
    };
  }, [clear, dismiss, open]);

  return (
    <MessageContext.Provider value={api}>
      {children}
      <Toast.Portal>
        <Toast.Viewport aria-label={regionLabel} className={styles.viewport}>
          {manager.toasts.map((toast) => {
            const type = normalizeType(toast.type);
            return (
              <Toast.Root
                className={`${styles.message} ${styles[type]}`}
                key={toast.id}
                swipeDirection={["up", "right"]}
                toast={toast}
              >
                <Toast.Content className={styles.body}>
                  <span aria-hidden="true" className={styles.icon}>
                    <Icon name={MESSAGE_ICON[type]} size={15} />
                  </span>
                  <Toast.Title className={styles.content} />
                  {toast.data?.dismissible && (
                    <Toast.Close
                      aria-label={dismissLabel}
                      className={styles.close}
                    >
                      <Icon name="lucide:x" size={13} />
                    </Toast.Close>
                  )}
                </Toast.Content>
              </Toast.Root>
            );
          })}
        </Toast.Viewport>
      </Toast.Portal>
    </MessageContext.Provider>
  );
}

function toastId(key: AppMessageKey): string {
  return `opendesign-message:${typeof key}:${String(key)}`;
}

function normalizeType(type: string | undefined): AppMessageType {
  return type === "success" ||
    type === "warning" ||
    type === "error" ||
    type === "loading"
    ? type
    : "info";
}
