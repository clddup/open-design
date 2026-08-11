import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@opendesign/ui";
import { describe, expect, it, vi } from "vitest";
import type { DiagnosticEvent } from "../../shared/diagnostics";
import { I18nProvider } from "../i18n";
import { DiagnosticNotifications } from "./DiagnosticNotifications";

const event: DiagnosticEvent = {
  version: 3,
  eventId: "diagnostic_1",
  occurredAt: "2026-08-10T12:00:00.000Z",
  level: "error",
  source: "agent",
  presentation: "toast",
  code: "model_bridge_failed",
  message: "The model bridge failed before returning a response.",
  appVersion: "0.1.0",
  platform: "win32",
  context: {
    conversationId: "conversation_1",
    runId: "run_1",
    requestId: "request_1",
  },
};

function renderNotifications(onDismiss = vi.fn()) {
  render(
    <TooltipProvider delayDuration={0}>
      <I18nProvider initialLocale="en">
        <DiagnosticNotifications events={[event]} onDismiss={onDismiss} />
      </I18nProvider>
    </TooltipProvider>,
  );
  return onDismiss;
}

describe("DiagnosticNotifications", () => {
  it("shows the error code, message and correlated run", () => {
    renderNotifications();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "OpenDesign encountered an error",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("model_bridge_failed");
    expect(screen.getByRole("alert")).toHaveTextContent(event.message);
    expect(screen.getByRole("alert")).toHaveTextContent("Run run_1");
  });

  it("copies a complete diagnostic report and can be dismissed", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const onDismiss = renderNotifications();

    await user.click(screen.getByRole("button", { name: "Copy diagnostic" }));
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining("Conversation ID: conversation_1"),
    );
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining("Request ID: request_1"),
    );
    expect(screen.getByText("Diagnostic copied")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Dismiss notification" }),
    );
    expect(onDismiss).toHaveBeenCalledWith(event.eventId);
  });
});
