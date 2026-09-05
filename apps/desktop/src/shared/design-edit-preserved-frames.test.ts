import { describe, expect, it } from "vitest";
import { EditDesignContract } from "./design-edit-tool";

const input = {
  label: "Edit",
  preservedFrames: [{ frameId: "frame", pageId: "page" }],
  edits: [
    {
      kind: "node",
      input: {
        label: "Edit",
        commands: [
          {
            commandId: "edit",
            type: "update_properties",
            nodeId: "node",
            opacity: 0.5,
          },
        ],
      },
    },
  ],
};

describe("Main-owned Frame preservation", () => {
  it("is absent from the Provider schema and cannot be supplied as model input", () => {
    expect(JSON.stringify(EditDesignContract.schema)).not.toContain(
      "preservedFrames",
    );
    expect(EditDesignContract.parse(input).ok).toBe(false);
    expect(EditDesignContract.parse(input, { canonical: true })).toMatchObject({
      ok: false,
    });
  });
  it("survives only the trusted internal projection", () => {
    const parsed = EditDesignContract.parse(input, { internal: true });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    expect(parsed.value.preservedFrames).toEqual(input.preservedFrames);
    expect(parsed.value.preservedFrames).not.toBe(input.preservedFrames);
  });
});
