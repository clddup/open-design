import { useCallback, useEffect, useState } from "react";
import type { DiagnosticEvent } from "../../../shared/diagnostics";
import { mergeDiagnosticNotifications } from "./diagnostic-notification-state";

export function useDiagnosticNotificationsController() {
  const [events, setEvents] = useState<DiagnosticEvent[]>([]);

  useEffect(() => {
    const desktop = window.desktop;
    if (!desktop || typeof desktop.onDiagnosticEvent !== "function") return;
    let active = true;
    const receive = (event: DiagnosticEvent) => {
      if (!active) return;
      setEvents((current) => mergeDiagnosticNotifications(current, [event]));
    };
    const unsubscribe = desktop.onDiagnosticEvent(receive);
    if (typeof desktop.getPendingDiagnostics === "function") {
      void desktop
        .getPendingDiagnostics()
        .then((pending) => {
          if (!active) return;
          setEvents((current) =>
            mergeDiagnosticNotifications(current, pending),
          );
        })
        .catch(() => undefined);
    }
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const dismiss = useCallback((eventId: string) => {
    setEvents((current) =>
      current.filter((event) => event.eventId !== eventId),
    );
  }, []);

  return { dismiss, events };
}
