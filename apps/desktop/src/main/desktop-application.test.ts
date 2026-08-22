import { describe, expect, it, vi } from "vitest";
import {
  DesktopApplication,
  DesktopApplicationStartContext,
} from "./desktop-application";

describe("DesktopApplication", () => {
  it("rolls back initialized resources in reverse order before non-zero exit", async () => {
    const order: string[] = [];
    const fixture = setup();

    await expect(
      fixture.application.start(async (startup) => {
        await Promise.resolve();
        startup.defer("database", () => {
          order.push("database");
        });
        startup.defer("ipc", async () => {
          await Promise.resolve();
          order.push("ipc");
        });
        throw new Error("window creation failed");
      }),
    ).rejects.toThrow("window creation failed");

    expect(order).toEqual(["ipc", "database"]);
    expect(fixture.reportStartupError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "window creation failed" }),
    );
    expect(fixture.exit).toHaveBeenCalledWith(1);
    expect(fixture.application.state).toBe("failed");
  });

  it("continues rollback after a disposer fails and reports the aggregate", async () => {
    const disposeDatabase = vi.fn();
    const fixture = setup();

    await expect(
      fixture.application.start(async (startup) => {
        await Promise.resolve();
        startup.defer("database", disposeDatabase);
        startup.defer("ipc", () => {
          throw new Error("remove failed");
        });
        throw new Error("startup failed");
      }),
    ).rejects.toThrow("startup failed");

    expect(disposeDatabase).toHaveBeenCalledOnce();
    expect(fixture.reportStartupError).toHaveBeenCalledTimes(2);
    const rollback = fixture.reportStartupError.mock.calls[1]?.[0];
    expect(rollback).toBeInstanceOf(AggregateError);
    expect(fixture.exit).toHaveBeenCalledOnce();
  });

  it("shares one concurrent startup and commits without rollback", async () => {
    const fixture = setup();
    const dispose = vi.fn();
    let finish!: () => void;
    const ready = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const initialize = vi.fn(
      async (startup: DesktopApplicationStartContext) => {
        startup.defer("resource", dispose);
        await ready;
        startup.commit();
      },
    );

    const first = fixture.application.start(initialize);
    const second = fixture.application.start(initialize);
    expect(first).toBe(second);
    finish();
    await Promise.all([first, second]);

    expect(initialize).toHaveBeenCalledOnce();
    expect(dispose).not.toHaveBeenCalled();
    expect(fixture.exit).not.toHaveBeenCalled();
    expect(fixture.application.state).toBe("ready");
    await expect(
      fixture.application.start(initialize),
    ).resolves.toBeUndefined();
    expect(initialize).toHaveBeenCalledOnce();
  });

  it("treats a missing commit as startup failure", async () => {
    const fixture = setup();
    const dispose = vi.fn();

    await expect(
      fixture.application.start(async (startup) => {
        await Promise.resolve();
        startup.defer("resource", dispose);
      }),
    ).rejects.toThrow("returned before commit");

    expect(dispose).toHaveBeenCalledOnce();
    expect(fixture.exit).toHaveBeenCalledWith(1);
  });

  it("prevents lifecycle mutation after commit", () => {
    const context = new DesktopApplicationStartContext();
    context.commit();

    expect(() => context.commit()).toThrow("already committed");
    expect(() => context.defer("late", vi.fn())).toThrow("after commit");
  });
});

function setup() {
  const exit = vi.fn();
  const reportStartupError = vi.fn<(error: unknown) => void>();
  return {
    application: new DesktopApplication({ exit, reportStartupError }),
    exit,
    reportStartupError,
  };
}
