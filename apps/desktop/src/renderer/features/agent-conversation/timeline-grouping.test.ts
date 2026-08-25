import { describe, expect, it } from "vitest";
import { translate } from "@/shared/i18n/messages";
import { groupAgentTimelineItems } from "./timeline-grouping";
import type { AgentTimelineItem } from "./timeline-types";

const item = (
  id: string,
  kind: AgentTimelineItem["kind"],
  state: AgentTimelineItem["state"],
  order: number,
): AgentTimelineItem => ({
  id,
  kind,
  state,
  order,
  time: "now",
  title: id,
});

describe("Agent timeline display grouping", () => {
  it("folds only adjacent non-error tools at their original position", () => {
    const entries = groupAgentTimelineItems(
      [
        item("message:before", "assistant", "done", 1),
        item("tool:first", "tool", "done", 2),
        item("tool:second", "tool", "done", 3),
        item("message:after", "assistant", "done", 4),
      ],
      (key, parameters) => translate("zh-CN", key, parameters),
    );

    expect(entries.map((entry) => entry.type)).toEqual([
      "item",
      "tool-group",
      "item",
    ]);
    expect(entries[1]).toMatchObject({
      type: "tool-group",
      state: "done",
      title: "已执行 2 项操作",
      items: [{ id: "tool:first" }, { id: "tool:second" }],
    });
  });

  it("leaves terminal errors visible outside completed tool groups", () => {
    const entries = groupAgentTimelineItems(
      [
        item("tool:first", "tool", "done", 1),
        item("tool:error", "tool", "error", 2),
        item("tool:after", "tool", "done", 3),
      ],
      (key, parameters) => translate("zh-CN", key, parameters),
    );

    expect(
      entries.map((entry) =>
        entry.type === "item" ? entry.item.id : entry.id,
      ),
    ).toEqual(["tool:first", "tool:error", "tool:after"]);
  });

  it("keeps an active tool group expanded by state", () => {
    const entries = groupAgentTimelineItems(
      [
        item("tool:first", "tool", "done", 1),
        item("tool:active", "tool", "active", 2),
      ],
      (key, parameters) => translate("zh-CN", key, parameters),
    );

    expect(entries[0]).toMatchObject({
      type: "tool-group",
      state: "active",
      title: "正在执行 2 项操作",
    });
  });
});
