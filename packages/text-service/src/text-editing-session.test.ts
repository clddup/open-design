import { describe, expect, it } from "vitest";
import {
  applyTextEditingListCommand,
  applyTextEditingSessionInput,
  createTextEditingSession,
  finalizeTextEditingSession,
  undoAutomaticTextList,
} from "./text-editing-session.js";
import type {
  TextParagraphRun,
  TextParagraphStyle,
} from "./text-paragraphs.js";

const plain: TextParagraphStyle = {
  listOptions: { type: "none" },
  indentation: 0,
  listSpacing: 0,
  paragraphIndent: 0,
  paragraphSpacing: 0,
};
const ordered: TextParagraphStyle = {
  ...plain,
  listOptions: { type: "ordered" },
  indentation: 1,
};

describe("Text Editing Session Service", () => {
  it("turns typed list shortcuts into semantic paragraph facts without persisting markers", () => {
    let state = createTextEditingSession("", [], plain);
    const automatic = applyTextEditingSessionInput(
      state,
      "- ",
      { start: 2, end: 2 },
      { automaticList: true },
    );
    expect(automatic.rewrite).toEqual({
      content: "",
      selection: { start: 0, end: 0 },
    });
    state = applyTextEditingSessionInput(
      automatic.state,
      "Alpha",
      { start: 5, end: 5 },
      { automaticList: false },
    ).state;

    expect(finalizeTextEditingSession(state)).toEqual({
      content: "Alpha",
      paragraphPatches: [
        {
          start: 0,
          end: 5,
          style: {
            listOptions: { type: "unordered" },
            indentation: 1,
          },
        },
      ],
    });
  });

  it("restores creation characters when automatic list styling is undone immediately", () => {
    const automatic = applyTextEditingSessionInput(
      createTextEditingSession("", [], plain),
      "1) ",
      { start: 3, end: 3 },
      { automaticList: true },
    );
    const undone = undoAutomaticTextList(automatic.state);
    expect(undone?.rewrite).toEqual({
      content: "1) ",
      selection: { start: 3, end: 3 },
    });
    expect(finalizeTextEditingSession(undone!.state)).toEqual({
      content: "1) ",
      paragraphPatches: [],
    });
  });

  it("inherits list facts across Enter without adding redundant commit patches", () => {
    const original = createTextEditingSession(
      "One",
      [{ start: 0, end: 3, style: ordered }],
      plain,
    );
    const afterEnter = applyTextEditingSessionInput(
      original,
      "One\n",
      { start: 4, end: 4 },
      { automaticList: false },
    ).state;
    const afterTyping = applyTextEditingSessionInput(
      afterEnter,
      "One\nTwo",
      { start: 7, end: 7 },
      { automaticList: false },
    ).state;
    expect(finalizeTextEditingSession(afterTyping)).toEqual({
      content: "One\nTwo",
      paragraphPatches: [],
    });
  });

  it("indents and outdents all selected list items with a five-level ceiling", () => {
    const content = "One\nTwo";
    const runs: TextParagraphRun<TextParagraphStyle>[] = [
      { start: 0, end: content.length, style: ordered },
    ];
    let state = createTextEditingSession(content, runs, plain);
    const indented = applyTextEditingListCommand(
      state,
      { start: 0, end: content.length },
      "indent",
    );
    expect(indented).toMatchObject({ changed: true, handled: true });
    state = indented.state;
    expect(finalizeTextEditingSession(state).paragraphPatches).toEqual([
      {
        start: 0,
        end: content.length,
        style: { indentation: 2 },
      },
    ]);
    const outdented = applyTextEditingListCommand(
      state,
      { start: 4, end: 4 },
      "outdent",
    );
    expect(outdented).toMatchObject({ changed: true, handled: true });
    expect(
      finalizeTextEditingSession(outdented.state).paragraphPatches,
    ).toEqual([{ start: 0, end: 4, style: { indentation: 2 } }]);
  });

  it("removes a marker at item start while retaining its indentation", () => {
    const state = createTextEditingSession(
      "Nested",
      [
        {
          start: 0,
          end: 6,
          style: { ...ordered, indentation: 3 },
        },
      ],
      plain,
    );
    const result = applyTextEditingListCommand(
      state,
      { start: 0, end: 0 },
      "remove-marker",
    );
    expect(finalizeTextEditingSession(result.state).paragraphPatches).toEqual([
      {
        start: 0,
        end: 6,
        style: { listOptions: { type: "none" } },
      },
    ]);
  });

  it("decreases an empty nested item and exits a level-one trailing item", () => {
    const nestedContent = "Parent\n\n";
    const nested = createTextEditingSession(
      nestedContent,
      [
        {
          start: 0,
          end: nestedContent.length,
          style: { ...ordered, indentation: 2 },
        },
      ],
      plain,
    );
    const decreased = applyTextEditingListCommand(
      nested,
      { start: 7, end: 7 },
      "exit-empty-item",
    );
    expect(decreased).toMatchObject({ changed: true, handled: true });
    expect(
      finalizeTextEditingSession(decreased.state).paragraphPatches,
    ).toEqual([{ start: 7, end: 8, style: { indentation: 1 } }]);

    const trailing = applyTextEditingSessionInput(
      createTextEditingSession(
        "Parent",
        [{ start: 0, end: 6, style: ordered }],
        plain,
      ),
      "Parent\n",
      { start: 7, end: 7 },
      { automaticList: false },
    ).state;
    const exited = applyTextEditingListCommand(
      trailing,
      { start: 7, end: 7 },
      "exit-empty-item",
    );
    expect(exited).toMatchObject({ changed: true, handled: true });
    expect(finalizeTextEditingSession(exited.state)).toEqual({
      content: "Parent\n",
      paragraphPatches: [],
    });
  });

  it("toggles ordered list styling over paragraph selections", () => {
    const content = "One\nTwo";
    const enabled = applyTextEditingListCommand(
      createTextEditingSession(content, [], plain),
      { start: 0, end: content.length },
      "toggle-ordered",
    );
    expect(finalizeTextEditingSession(enabled.state).paragraphPatches).toEqual([
      {
        start: 0,
        end: content.length,
        style: {
          listOptions: { type: "ordered" },
          indentation: 1,
        },
      },
    ]);
    const disabled = applyTextEditingListCommand(
      enabled.state,
      { start: 0, end: content.length },
      "toggle-ordered",
    );
    expect(finalizeTextEditingSession(disabled.state).paragraphPatches).toEqual(
      [{ start: 0, end: content.length, style: { indentation: 1 } }],
    );
  });

  it("rejects selections that split a UTF-16 surrogate pair", () => {
    expect(() =>
      applyTextEditingListCommand(
        createTextEditingSession("😀", [], plain),
        { start: 1, end: 1 },
        "toggle-unordered",
      ),
    ).toThrow("UTF-16");
  });
});
