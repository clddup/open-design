// @vitest-environment happy-dom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageProvider, useMessage } from "./Message";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("MessageProvider", () => {
  it("shows lightweight success feedback and dismisses it automatically", () => {
    vi.useFakeTimers();
    render(
      <MessageProvider>
        <MessageTrigger action="success" />
      </MessageProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show message" }));
    const toast = screen.getByRole("dialog", { name: "Exported Brand.png" });

    act(() => {
      vi.advanceTimersByTime(2_599);
    });
    expect(screen.getByText("Exported Brand.png")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    fireEvent.transitionEnd(toast);
    expect(screen.queryByText("Exported Brand.png")).toBeNull();
  });

  it("updates a stable loading key in place and restarts its duration", () => {
    vi.useFakeTimers();
    render(
      <MessageProvider>
        <MessageTrigger action="update" />
      </MessageProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show message" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByText("Exporting…")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Update message" }));
    const updated = screen.getAllByRole("dialog");
    expect(updated).toHaveLength(1);
    expect(screen.queryByText("Exporting…")).toBeNull();
    expect(screen.getByText("Exported Brand.png")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1_200);
    });
    fireEvent.transitionEnd(updated[0]);
    expect(screen.queryByText("Exported Brand.png")).toBeNull();
  });

  it("pauses auto-dismiss while the user is inspecting a message", () => {
    vi.useFakeTimers();
    render(
      <MessageProvider>
        <MessageTrigger action="pause" />
      </MessageProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show message" }));
    const message = screen.getByRole("dialog", { name: "Saved locally" });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    fireEvent.mouseEnter(message);
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(screen.getByText("Saved locally")).toBeInTheDocument();
    fireEvent.mouseLeave(message);
    act(() => {
      vi.advanceTimersByTime(599);
    });
    expect(screen.getByText("Saved locally")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    fireEvent.transitionEnd(message);
    expect(screen.queryByText("Saved locally")).toBeNull();
  });

  it("bounds the stack and exposes persistent errors as dismissible alerts", () => {
    render(
      <MessageProvider dismissLabel="Close feedback" maxCount={2}>
        <MessageTrigger action="stack" />
      </MessageProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show message" }));
    expect(
      screen.getByRole("dialog", { name: "First", hidden: true }),
    ).toHaveAttribute("data-limited");
    expect(screen.getByText("Second")).toBeInTheDocument();
    const alert = screen.getByRole("alertdialog", { hidden: true });
    const close = alert.querySelector("button");
    if (!close) throw new Error("Missing error close control");
    expect(close).toHaveAttribute("aria-label", "Close feedback");
    fireEvent.click(close);
    fireEvent.transitionEnd(alert);
    expect(screen.queryByRole("alertdialog", { hidden: true })).toBeNull();
  });
});

function MessageTrigger({
  action,
}: {
  action: "success" | "update" | "pause" | "stack";
}) {
  const message = useMessage();
  return (
    <>
      <button
        aria-label="Show message"
        onClick={() => {
          if (action === "success") {
            message.success("Exported Brand.png");
          } else if (action === "update") {
            message.loading("Exporting…", { key: "export" });
          } else if (action === "pause") {
            message.info("Saved locally", { durationMs: 1_000 });
          } else {
            message.info("First", { durationMs: 0 });
            message.warning("Second", { durationMs: 0 });
            message.error("Third", { durationMs: 0 });
          }
        }}
        type="button"
      />
      {action === "update" && (
        <button
          aria-label="Update message"
          onClick={() =>
            message.success("Exported Brand.png", {
              durationMs: 1_200,
              key: "export",
            })
          }
          type="button"
        />
      )}
    </>
  );
}
