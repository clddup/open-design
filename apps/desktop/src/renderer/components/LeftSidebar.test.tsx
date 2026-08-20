import { createWelcomeDocument } from "@opendesign/editor-runtime";
import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { layerPanelSelection, LeftSidebar } from "./LeftSidebar";

function pageActionProps() {
  return {
    variableActions: {
      createCollection: vi.fn(() => true),
      updateCollection: vi.fn(() => true),
      moveCollection: vi.fn(() => true),
      deleteCollection: vi.fn(() => true),
      addMode: vi.fn(() => true),
      removeMode: vi.fn(() => true),
      createVariable: vi.fn(() => true),
      updateVariable: vi.fn(() => true),
      deleteVariable: vi.fn(() => true),
      setBinding: vi.fn(() => true),
      setExplicitMode: vi.fn(() => true),
    },
    onDeleteAsset: vi.fn(() => ({ ok: false, error: "Unavailable" }) as const),
    onImportAsset: vi.fn(() => Promise.resolve({ ok: true } as const)),
    onLocateAsset: vi.fn(),
    onLocateComponent: vi.fn(),
    onPlaceAsset: vi.fn(() => ({ ok: false, error: "Unavailable" }) as const),
    onPlaceComponent: vi.fn(
      () => ({ ok: false, error: "Unavailable" }) as const,
    ),
    onReplaceAsset: vi.fn(() => Promise.resolve({ ok: true } as const)),
    onUpdateComponentLayer: vi.fn(),
    onRenameLayer: vi.fn(() => ({ ok: true }) as const),
    onCreatePage: vi.fn(() => ({ ok: false, error: "Unavailable" }) as const),
    onDeletePage: vi.fn(() => ({ ok: false, error: "Unavailable" }) as const),
    onDuplicatePage: vi.fn(
      () => ({ ok: false, error: "Unavailable" }) as const,
    ),
    onRenamePage: vi.fn(() => ({ ok: false, error: "Unavailable" }) as const),
    onReorderPage: vi.fn(() => ({ ok: false, error: "Unavailable" }) as const),
  };
}

describe("LeftSidebar layer tree", () => {
  it("renames one persistent layer inline with Enter", async () => {
    const user = userEvent.setup();
    const onRenameLayer = vi.fn(() => ({ ok: true }) as const);
    render(
      <I18nProvider initialLocale="en">
        <LeftSidebar
          {...pageActionProps()}
          activePageId="page_welcome"
          document={createWelcomeDocument()}
          onPageChange={vi.fn()}
          onRenameLayer={onRenameLayer}
          onReparent={vi.fn(() => ({ ok: true }) as const)}
          onSelect={vi.fn()}
          onTabChange={vi.fn()}
          onToggleLock={vi.fn()}
          onToggleVisibility={vi.fn()}
          selectedNodeIds={[]}
          tab="layers"
        />
      </I18nProvider>,
    );

    await user.dblClick(screen.getByRole("button", { name: "Atomic changes" }));
    const input = screen.getByRole("textbox", {
      name: "Rename Atomic changes",
    });
    await user.clear(input);
    await user.type(input, "Atomic workflow{Enter}");

    expect(onRenameLayer).toHaveBeenCalledWith(
      { nodeId: "feature_two" },
      "Atomic workflow",
    );
    expect(
      screen.queryByRole("textbox", { name: "Rename Atomic changes" }),
    ).not.toBeInTheDocument();
  });

  it("groups Styles and Variables under one Library view and searches layers", async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();
    const props = {
      ...pageActionProps(),
      activePageId: "page_welcome",
      document: createWelcomeDocument(),
      onPageChange: vi.fn(),
      onReparent: vi.fn(() => ({ ok: true }) as const),
      onSelect: vi.fn(),
      onTabChange,
      onToggleLock: vi.fn(),
      onToggleVisibility: vi.fn(),
      selectedNodeIds: [],
    };
    const view = render(
      <I18nProvider initialLocale="en">
        <LeftSidebar {...props} tab="layers" />
      </I18nProvider>,
    );

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Layers",
      "Assets",
      "Library",
    ]);
    expect(screen.queryByText("Search unavailable")).not.toBeInTheDocument();
    await user.type(
      screen.getByRole("searchbox", { name: "Search layers" }),
      "Atomic",
    );
    expect(screen.getByText("Atomic changes")).toBeInTheDocument();
    expect(screen.getByText("Capabilities")).toBeInTheDocument();
    expect(screen.queryByText("Structured editing")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Library" }));
    expect(onTabChange).toHaveBeenLastCalledWith("styles");
    view.rerender(
      <I18nProvider initialLocale="en">
        <LeftSidebar {...props} tab="styles" />
      </I18nProvider>,
    );
    expect(screen.getByRole("button", { name: "Styles" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(screen.getByRole("button", { name: "Variables" }));
    expect(onTabChange).toHaveBeenLastCalledWith("variables");
  });

  it("presents one Component Set asset and places its default Variant", async () => {
    const user = userEvent.setup();
    const document = structuredClone(createWelcomeDocument());
    document.componentsById = {
      button_default: {
        id: "button_default",
        name: "State=Default",
        rootNodeId: "feature_group",
        componentPropertyOrder: [],
        componentPropertyDefinitions: {},
        variantSetId: "button_set",
        variantProperties: { State: "Default" },
        extensions: {},
      },
      button_hover: {
        id: "button_hover",
        name: "State=Hover",
        rootNodeId: "feature_two",
        componentPropertyOrder: [],
        componentPropertyDefinitions: {},
        variantSetId: "button_set",
        variantProperties: { State: "Hover" },
        extensions: {},
      },
    };
    document.variantSetsById.button_set = {
      id: "button_set",
      name: "Button",
      rootNodeId: "frame_welcome",
      defaultComponentId: "button_default",
      propertyOrder: ["State"],
      componentPropertyDefinitions: {
        State: {
          type: "VARIANT",
          defaultValue: "Default",
          variantOptions: ["Default", "Hover"],
        },
      },
      extensions: {},
    };
    const onPlaceComponent = vi.fn(
      () => ({ ok: true, message: "Placed" }) as const,
    );
    render(
      <I18nProvider initialLocale="en">
        <LeftSidebar
          {...pageActionProps()}
          activePageId="page_welcome"
          document={document}
          onPageChange={vi.fn()}
          onPlaceComponent={onPlaceComponent}
          onReparent={vi.fn(() => ({ ok: true }) as const)}
          onSelect={vi.fn()}
          onTabChange={vi.fn()}
          onToggleLock={vi.fn()}
          onToggleVisibility={vi.fn()}
          selectedNodeIds={[]}
          tab="assets"
        />
      </I18nProvider>,
    );

    expect(screen.getByText("2 variants · 0 instances")).toBeVisible();
    expect(screen.queryByText("State=Default")).toBeNull();
    expect(screen.queryByText("State=Hover")).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Place Button instance" }),
    );
    expect(onPlaceComponent).toHaveBeenCalledWith("button_default");
  });

  it("supports Page naming by double-click, F2, Enter, Escape, and visible validation", async () => {
    const user = userEvent.setup();
    const document = createWelcomeDocument();
    const onRenamePage = vi
      .fn()
      .mockReturnValueOnce({ ok: false, error: "Invalid Page name" })
      .mockReturnValueOnce({
        ok: true,
        pageId: "page_welcome",
        name: "Homepage",
      });
    render(
      <I18nProvider initialLocale="en">
        <LeftSidebar
          {...pageActionProps()}
          activePageId="page_welcome"
          document={document}
          onPageChange={vi.fn()}
          onRenamePage={onRenamePage}
          onReparent={vi.fn(() => ({ ok: true }) as const)}
          onSelect={vi.fn()}
          onTabChange={vi.fn()}
          onToggleLock={vi.fn()}
          onToggleVisibility={vi.fn()}
          selectedNodeIds={[]}
          tab="layers"
        />
      </I18nProvider>,
    );

    await user.dblClick(screen.getByRole("button", { name: "Welcome" }));
    const input = screen.getByRole("textbox", { name: "Rename Welcome" });
    await user.clear(input);
    await user.keyboard("{Enter}");
    expect(onRenamePage).toHaveBeenCalledWith("page_welcome", "");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Invalid Page name")).toBeInTheDocument();

    await user.type(input, "Homepage{Enter}");
    expect(onRenamePage).toHaveBeenLastCalledWith("page_welcome", "Homepage");
    expect(
      screen.queryByRole("textbox", { name: "Rename Welcome" }),
    ).toBeNull();

    const pageButton = screen.getByRole("button", { name: "Welcome" });
    pageButton.focus();
    await user.keyboard("{F2}");
    expect(
      screen.getByRole("textbox", { name: "Rename Welcome" }),
    ).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("textbox", { name: "Rename Welcome" }),
    ).toBeNull();
  });

  it("exposes create, duplicate, delete, and final-index Page reorder controls", async () => {
    const user = userEvent.setup();
    const document = structuredClone(createWelcomeDocument());
    document.pageOrder.push("page_two", "page_three");
    document.pagesById.page_two = {
      id: "page_two",
      name: "Page 2",
      rootNodeIds: [],
      extensions: {},
    };
    document.pagesById.page_three = {
      id: "page_three",
      name: "Page 3",
      rootNodeIds: [],
      extensions: {},
    };
    const onCreatePage = vi.fn(
      () =>
        ({
          ok: true,
          pageId: "page_four",
          name: "Page 4",
        }) as const,
    );
    const onDuplicatePage = vi.fn(
      () =>
        ({
          ok: true,
          pageId: "page_two_copy",
        }) as const,
    );
    const onDeletePage = vi.fn(
      () =>
        ({
          ok: true,
          pageId: "page_three",
        }) as const,
    );
    const onReorderPage = vi.fn(
      () =>
        ({
          ok: true,
          pageId: "page_welcome",
        }) as const,
    );
    const onPageChange = vi.fn();
    render(
      <I18nProvider initialLocale="en">
        <LeftSidebar
          {...pageActionProps()}
          activePageId="page_welcome"
          document={document}
          onCreatePage={onCreatePage}
          onDeletePage={onDeletePage}
          onDuplicatePage={onDuplicatePage}
          onPageChange={onPageChange}
          onReorderPage={onReorderPage}
          onReparent={vi.fn(() => ({ ok: true }) as const)}
          onSelect={vi.fn()}
          onTabChange={vi.fn()}
          onToggleLock={vi.fn()}
          onToggleVisibility={vi.fn()}
          selectedNodeIds={[]}
          tab="layers"
        />
      </I18nProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Create Page" }));
    expect(onCreatePage).toHaveBeenCalledTimes(1);
    expect(onPageChange).toHaveBeenCalledWith("page_four");
    expect(screen.queryByText("Created Page")).toBeNull();

    await user.click(
      screen.getByRole("button", { name: "Actions for Page 2" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    expect(onDuplicatePage).toHaveBeenCalledWith("page_two");
    expect(onPageChange).toHaveBeenCalledWith("page_two_copy");
    expect(screen.queryByText("Duplicated Page")).toBeNull();

    await user.click(
      screen.getByRole("button", { name: "Actions for Page 3" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(onDeletePage).toHaveBeenCalledWith("page_three");
    expect(screen.queryByText("Deleted Page")).toBeNull();

    const source = screen.getByRole("button", {
      name: "Welcome",
    }).parentElement;
    const target = screen.getByRole("button", { name: "Page 3" }).parentElement;
    if (!source || !target) throw new Error("Missing Page rows");
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
      top: 100,
      bottom: 128,
      left: 0,
      right: 220,
      width: 220,
      height: 28,
      x: 0,
      y: 100,
      toJSON: () => undefined,
    });
    const dataTransfer = {
      dropEffect: "none",
      effectAllowed: "none",
      setData: vi.fn(),
    };
    fireEvent.dragStart(source, { dataTransfer });
    const drop = createEvent.drop(target, { dataTransfer });
    Object.defineProperty(drop, "clientY", { value: 127 });
    fireEvent(target, drop);
    expect(onReorderPage).toHaveBeenCalledWith("page_welcome", 2);
    expect(screen.queryByText("Reordered Page")).toBeNull();
  });

  it("presents Boolean groups as named, collapsible vector containers", async () => {
    const user = userEvent.setup();
    const document = structuredClone(createWelcomeDocument());
    const parent = document.nodesById.feature_group;
    const first = document.nodesById.feature_one;
    const second = document.nodesById.feature_two;
    if (
      !parent ||
      parent.kind !== "group" ||
      !first ||
      !second ||
      first.kind !== "rectangle" ||
      second.kind !== "rectangle"
    ) {
      throw new Error("Missing Boolean tree fixtures");
    }
    document.nodesById.boolean_cards = {
      id: "boolean_cards",
      kind: "boolean",
      name: "Boolean cards",
      parentId: parent.id,
      childIds: [first.id, second.id],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 0, 0],
      size: { width: 640, height: 220 },
      exportSettings: [],
      opacity: 1,
      properties: {
        operation: "union",
        fills: [{ type: "solid", color: "#ffffff", opacity: 1 }],
        strokes: [],
        strokeWidth: 0,
      },
      extensions: {},
    };
    first.parentId = "boolean_cards";
    second.parentId = "boolean_cards";
    parent.childIds = ["boolean_cards", "feature_three"];

    render(
      <I18nProvider initialLocale="en">
        <LeftSidebar
          {...pageActionProps()}
          activePageId="page_welcome"
          document={document}
          onPageChange={vi.fn()}
          onReparent={vi.fn(() => ({ ok: true }) as const)}
          onSelect={vi.fn()}
          onTabChange={vi.fn()}
          onToggleLock={vi.fn()}
          onToggleVisibility={vi.fn()}
          selectedNodeIds={[]}
          tab="layers"
        />
      </I18nProvider>,
    );

    const booleanLayer = screen.getByRole("button", {
      name: "Boolean cards",
    });
    expect(
      booleanLayer.querySelector('[data-icon="lucide:combine"]'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: first.name }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Collapse Boolean cards" }),
    );
    expect(
      screen.queryByRole("button", { name: first.name }),
    ).not.toBeInTheDocument();
  });

  it("distinguishes own, inherited, and unlocked layer states", async () => {
    const user = userEvent.setup();
    const document = structuredClone(createWelcomeDocument());
    const frame = document.nodesById.frame_welcome;
    const child = document.nodesById.feature_one;
    if (!frame || !child) throw new Error("Missing layer fixtures");
    frame.locked = true;
    const onToggleLock = vi.fn();
    const view = render(
      <I18nProvider initialLocale="en">
        <LeftSidebar
          {...pageActionProps()}
          activePageId="page_welcome"
          document={document}
          onPageChange={vi.fn()}
          onReparent={vi.fn(() => ({ ok: true }) as const)}
          onSelect={vi.fn()}
          onTabChange={vi.fn()}
          onToggleLock={onToggleLock}
          onToggleVisibility={vi.fn()}
          selectedNodeIds={[]}
          tab="layers"
        />
      </I18nProvider>,
    );

    const ownLock = screen.getByRole("button", {
      name: `Unlock ${frame.name}`,
    });
    expect(ownLock).toHaveAttribute("aria-pressed", "true");
    expect(
      ownLock.querySelector('[data-icon="lucide:lock"]'),
    ).toBeInTheDocument();
    await user.click(ownLock);
    expect(onToggleLock).toHaveBeenCalledWith(frame.id);

    const inheritedLock = screen.getByRole("button", {
      name: `${child.name} is locked by its parent`,
    });
    expect(inheritedLock).toBeDisabled();
    expect(inheritedLock).toHaveAttribute("aria-pressed", "true");
    expect(
      inheritedLock.querySelector('[data-icon="lucide:lock"]'),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: child.name })).toHaveAttribute(
      "draggable",
      "false",
    );

    const unlockedDocument = structuredClone(document);
    const unlockedFrame = unlockedDocument.nodesById.frame_welcome;
    if (!unlockedFrame) throw new Error("Missing frame fixture");
    unlockedFrame.locked = false;
    view.rerender(
      <I18nProvider initialLocale="en">
        <LeftSidebar
          {...pageActionProps()}
          activePageId="page_welcome"
          document={unlockedDocument}
          onPageChange={vi.fn()}
          onReparent={vi.fn(() => ({ ok: true }) as const)}
          onSelect={vi.fn()}
          onTabChange={vi.fn()}
          onToggleLock={onToggleLock}
          onToggleVisibility={vi.fn()}
          selectedNodeIds={[]}
          tab="layers"
        />
      </I18nProvider>,
    );

    const unlocked = screen.getByRole("button", {
      name: `Lock ${child.name}`,
    });
    expect(unlocked).not.toBeDisabled();
    expect(unlocked).toHaveAttribute("aria-pressed", "false");
    expect(
      unlocked.querySelector('[data-icon="lucide:unlock"]'),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: child.name })).toHaveAttribute(
      "draggable",
      "true",
    );
  });

  it("collapses with the disclosure control and reveals selected descendants", async () => {
    const user = userEvent.setup();
    const document = createWelcomeDocument();
    const frame = document.nodesById.frame_welcome;
    const child = document.nodesById.feature_one;
    if (!frame || !child) throw new Error("Missing layer fixtures");
    const onSelect = vi.fn();
    const renderSidebar = (selectedNodeIds: readonly string[]) => (
      <I18nProvider initialLocale="en">
        <LeftSidebar
          {...pageActionProps()}
          activePageId="page_welcome"
          document={document}
          onPageChange={vi.fn()}
          onReparent={vi.fn(() => ({ ok: true }) as const)}
          onSelect={onSelect}
          onTabChange={vi.fn()}
          onToggleLock={vi.fn()}
          onToggleVisibility={vi.fn()}
          selectedNodeIds={selectedNodeIds}
          tab="layers"
        />
      </I18nProvider>
    );
    const view = render(renderSidebar([]));

    await user.click(
      screen.getByRole("button", { name: `Collapse ${frame.name}` }),
    );
    expect(
      screen.queryByRole("button", { name: child.name }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: `Expand ${frame.name}` }),
    ).toBeInTheDocument();

    view.rerender(renderSidebar([child.id]));
    expect(
      await screen.findByRole("button", { name: child.name }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: `Collapse ${frame.name}` }),
    );
    await user.click(screen.getByRole("button", { name: frame.name }));
    expect(onSelect).toHaveBeenCalledWith([frame.id], frame.id);
    expect(
      screen.getByRole("button", { name: child.name }),
    ).toBeInTheDocument();
  });

  it("matches Figma layer-panel replace, range, and toggle selection", () => {
    const visible = ["frame", "title", "body", "footer"];
    expect(
      layerPanelSelection(visible, ["title"], "title", "footer", {
        ctrlKey: false,
        metaKey: false,
        shiftKey: true,
      }),
    ).toEqual({
      nodeIds: ["title", "body", "footer"],
      anchorNodeId: "title",
    });
    expect(
      layerPanelSelection(visible, ["title", "footer"], "footer", "body", {
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
      }),
    ).toEqual({ nodeIds: ["title", "body", "footer"], anchorNodeId: "body" });
    expect(
      layerPanelSelection(visible, ["title", "body"], "body", "body", {
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
      }),
    ).toEqual({ nodeIds: ["title"], anchorNodeId: "title" });
    expect(
      layerPanelSelection(visible, ["title", "body"], "body", "footer", {
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      }),
    ).toEqual({ nodeIds: ["footer"], anchorNodeId: "footer" });
  });

  it("exposes Figma layer-state controls and projects row hover to the canvas", async () => {
    const user = userEvent.setup();
    const document = structuredClone(createWelcomeDocument());
    const title = document.nodesById.title_welcome;
    if (!title) throw new Error("Missing title fixture");
    title.visible = false;
    const onLayerHoverChange = vi.fn();
    const onToggleLock = vi.fn();
    const onToggleVisibility = vi.fn();
    render(
      <I18nProvider initialLocale="en">
        <LeftSidebar
          {...pageActionProps()}
          activePageId="page_welcome"
          document={document}
          onLayerHoverChange={onLayerHoverChange}
          onPageChange={vi.fn()}
          onReparent={vi.fn(() => ({ ok: true }) as const)}
          onSelect={vi.fn()}
          onTabChange={vi.fn()}
          onToggleLock={onToggleLock}
          onToggleVisibility={onToggleVisibility}
          selectedNodeIds={[]}
          tab="layers"
        />
      </I18nProvider>,
    );

    const row = screen
      .getByRole("button", { name: "Title" })
      .closest('[role="treeitem"]');
    if (!row) throw new Error("Missing title layer row");
    fireEvent.pointerEnter(row);
    expect(onLayerHoverChange).toHaveBeenLastCalledWith({
      nodeId: "title_welcome",
    });
    fireEvent.pointerLeave(row);
    expect(onLayerHoverChange).toHaveBeenLastCalledWith(null);

    await user.click(screen.getByRole("button", { name: "Show Title" }));
    expect(onToggleVisibility).toHaveBeenCalledWith("title_welcome");
    await user.click(screen.getByRole("button", { name: "Lock Title" }));
    expect(onToggleLock).toHaveBeenCalledWith("title_welcome");
    expect(
      screen.queryByRole("button", { name: "Delete Title" }),
    ).not.toBeInTheDocument();
  });

  it("shows projected Instance layers and selects them by stable source path", async () => {
    const user = userEvent.setup();
    const document = structuredClone(createWelcomeDocument());
    document.componentsById.welcome_component = {
      id: "welcome_component",
      name: "Welcome",
      rootNodeId: "frame_welcome",
      componentPropertyOrder: [],
      componentPropertyDefinitions: {},
      variantProperties: {},
      extensions: {},
    };
    document.pagesById.page_instances = {
      id: "page_instances",
      name: "Instances",
      rootNodeIds: ["welcome_instance"],
      extensions: {},
    };
    document.pageOrder.push("page_instances");
    document.nodesById.welcome_instance = {
      id: "welcome_instance",
      kind: "instance",
      name: "Welcome instance",
      parentId: null,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 0, 0],
      size: { width: 960, height: 640 },
      exportSettings: [],
      opacity: 1,
      properties: {
        componentId: "welcome_component",
        componentProperties: {},
        overrides: [],
      },
      extensions: {},
    };
    const onLayerHoverChange = vi.fn();
    const onSelect = vi.fn();
    const onUpdateComponentLayer = vi.fn();
    render(
      <I18nProvider initialLocale="en">
        <LeftSidebar
          {...pageActionProps()}
          activePageId="page_instances"
          document={document}
          onLayerHoverChange={onLayerHoverChange}
          onPageChange={vi.fn()}
          onReparent={vi.fn(() => ({ ok: true }) as const)}
          onSelect={onSelect}
          onTabChange={vi.fn()}
          onToggleLock={vi.fn()}
          onToggleVisibility={vi.fn()}
          onUpdateComponentLayer={onUpdateComponentLayer}
          selectedNodeIds={["welcome_instance"]}
          tab="layers"
        />
      </I18nProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Title" }));
    expect(onSelect).toHaveBeenCalledWith(
      ["welcome_instance"],
      "welcome_instance",
      {
        instanceId: "welcome_instance",
        sourcePath: ["title_welcome"],
      },
    );
    const titleRow = screen
      .getByRole("button", { name: "Title" })
      .closest('[role="treeitem"]');
    if (!titleRow) throw new Error("Missing projected title row");
    fireEvent.pointerEnter(titleRow);
    expect(onLayerHoverChange).toHaveBeenLastCalledWith({
      nodeId: "welcome_instance",
      componentTarget: {
        instanceId: "welcome_instance",
        sourcePath: ["title_welcome"],
      },
    });
    await user.click(screen.getByRole("button", { name: "Lock Title" }));
    expect(onUpdateComponentLayer).toHaveBeenLastCalledWith(
      {
        instanceId: "welcome_instance",
        sourcePath: ["title_welcome"],
      },
      { locked: true },
    );
    expect(
      screen.queryByRole("button", { name: "Delete Title" }),
    ).not.toBeInTheDocument();

    await user.type(
      screen.getByRole("searchbox", { name: "Search layers" }),
      "Capabilities",
    );
    expect(
      screen.getByRole("button", { name: "Welcome instance" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Capabilities" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Title" }),
    ).not.toBeInTheDocument();
  });

  it("moves a same-parent selected block with explicit before feedback", () => {
    const document = createWelcomeDocument();
    const onReparent = vi.fn(() => ({ ok: true }) as const);
    render(
      <I18nProvider initialLocale="en">
        <LeftSidebar
          {...pageActionProps()}
          activePageId="page_welcome"
          document={document}
          onPageChange={vi.fn()}
          onReparent={onReparent}
          onSelect={vi.fn()}
          onTabChange={vi.fn()}
          onToggleLock={vi.fn()}
          onToggleVisibility={vi.fn()}
          selectedNodeIds={["title_welcome", "subtitle_welcome"]}
          tab="layers"
        />
      </I18nProvider>,
    );
    const source = screen.getByRole("button", { name: "Title" });
    const target = screen
      .getByRole("button", { name: "Capabilities" })
      .closest('[role="treeitem"]');
    if (!target) throw new Error("Missing target layer row");
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
      top: 100,
      bottom: 128,
      left: 0,
      right: 220,
      width: 220,
      height: 28,
      x: 0,
      y: 100,
      toJSON: () => undefined,
    });
    const dataTransfer = {
      dropEffect: "none",
      effectAllowed: "none",
      setData: vi.fn(),
    };

    fireEvent.dragStart(source, { dataTransfer });
    expect(screen.getByRole("status")).toHaveTextContent("Moving 2 layers");
    const dragOver = createEvent.dragOver(target, { dataTransfer });
    Object.defineProperty(dragOver, "clientY", { value: 101 });
    fireEvent(target, dragOver);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Place before Capabilities",
    );
    expect(screen.getByText("Before")).toBeInTheDocument();
    const drop = createEvent.drop(target, { dataTransfer });
    Object.defineProperty(drop, "clientY", { value: 101 });
    fireEvent(target, drop);

    expect(onReparent).toHaveBeenCalledWith({
      nodeIds: ["title_welcome", "subtitle_welcome"],
      parentId: "frame_welcome",
      index: 1,
      position: "before",
      targetNodeId: "feature_group",
    });
    expect(screen.getByRole("status")).toHaveTextContent("Moved 2 layers");
    expect(screen.queryByText("Before")).not.toBeInTheDocument();
  });

  it("ignores external drag payloads and reports rejected inside moves", () => {
    const document = createWelcomeDocument();
    const onReparent = vi.fn(
      () => ({ ok: false, error: "Rejected by hierarchy planner" }) as const,
    );
    render(
      <I18nProvider initialLocale="en">
        <LeftSidebar
          {...pageActionProps()}
          activePageId="page_welcome"
          document={document}
          onPageChange={vi.fn()}
          onReparent={onReparent}
          onSelect={vi.fn()}
          onTabChange={vi.fn()}
          onToggleLock={vi.fn()}
          onToggleVisibility={vi.fn()}
          selectedNodeIds={[]}
          tab="layers"
        />
      </I18nProvider>,
    );
    const source = screen.getByRole("button", { name: "Title" });
    const target = screen
      .getByRole("button", { name: "Capabilities" })
      .closest('[role="treeitem"]');
    if (!target) throw new Error("Missing target layer row");
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
      top: 100,
      bottom: 128,
      left: 0,
      right: 220,
      width: 220,
      height: 28,
      x: 0,
      y: 100,
      toJSON: () => undefined,
    });
    const dataTransfer = {
      dropEffect: "none",
      effectAllowed: "none",
      setData: vi.fn(),
      getData: vi.fn(() => "feature_one"),
    };

    const externalDrop = createEvent.drop(target, { dataTransfer });
    Object.defineProperty(externalDrop, "clientY", { value: 114 });
    fireEvent(target, externalDrop);
    expect(onReparent).not.toHaveBeenCalled();

    fireEvent.dragStart(source, { dataTransfer });
    const dragOver = createEvent.dragOver(target, { dataTransfer });
    Object.defineProperty(dragOver, "clientY", { value: 114 });
    fireEvent(target, dragOver);
    expect(screen.getByText("Inside")).toBeInTheDocument();
    const drop = createEvent.drop(target, { dataTransfer });
    Object.defineProperty(drop, "clientY", { value: 114 });
    fireEvent(target, drop);

    expect(onReparent).toHaveBeenCalledWith({
      nodeIds: ["title_welcome"],
      parentId: "feature_group",
      index: 3,
      position: "inside",
      targetNodeId: "feature_group",
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Rejected by hierarchy planner",
    );
  });
});

describe("LeftSidebar image assets", () => {
  it("shows real file assets, searches, locates, drags stable IDs, imports, and protects referenced deletion", async () => {
    const user = userEvent.setup();
    const document = structuredClone(createWelcomeDocument());
    document.assetsById.asset_photo = {
      id: "asset_photo",
      kind: "image",
      name: "Campaign hero",
      mimeType: "image/png",
      source: { type: "data", value: "aW1hZ2U=" },
      size: { width: 1200, height: 800 },
      extensions: {},
    };
    document.nodesById.hero_photo = {
      id: "hero_photo",
      kind: "image",
      name: "Campaign hero",
      parentId: "frame_welcome",
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 20, 20],
      size: { width: 300, height: 200 },
      exportSettings: [],
      opacity: 1,
      properties: {
        assetId: "asset_photo",
        placement: { mode: "fit" },
        altText: "",
        cornerRadius: 0,
      },
      extensions: {},
    };
    const frame = document.nodesById.frame_welcome;
    if (!frame) throw new Error("Missing Frame fixture");
    frame.childIds.push("hero_photo");
    const onLocateAsset = vi.fn();
    const onImportAsset = vi.fn(() => Promise.resolve({ ok: true } as const));
    const onDeleteAsset = vi.fn(() => ({ ok: true }) as const);
    const view = render(
      <I18nProvider initialLocale="en">
        <LeftSidebar
          {...pageActionProps()}
          activePageId="page_welcome"
          document={document}
          onDeleteAsset={onDeleteAsset}
          onImportAsset={onImportAsset}
          onLocateAsset={onLocateAsset}
          onPageChange={vi.fn()}
          onReparent={vi.fn(() => ({ ok: true }) as const)}
          onSelect={vi.fn()}
          onTabChange={vi.fn()}
          onToggleLock={vi.fn()}
          onToggleVisibility={vi.fn()}
          selectedNodeIds={[]}
          tab="assets"
        />
      </I18nProvider>,
    );

    const searchInput = screen.getByRole("searchbox", {
      name: "Search image assets",
    });
    expect(searchInput).toBeEnabled();
    expect(screen.getByText("Campaign hero")).toBeInTheDocument();
    expect(screen.getByText("Used 1 times · 1200 × 800")).toBeInTheDocument();
    expect(view.container.querySelector("img")).toHaveAttribute(
      "src",
      "data:image/png;base64,aW1hZ2U=",
    );

    await user.click(
      screen.getByRole("button", { name: "Locate Campaign hero" }),
    );
    expect(onLocateAsset).toHaveBeenCalledWith({
      nodeId: "hero_photo",
      pageId: "page_welcome",
      kind: "image-node",
    });

    const dataTransfer = {
      effectAllowed: "none",
      setData: vi.fn(),
    };
    fireEvent.dragStart(
      screen.getByRole("button", { name: "Locate Campaign hero" }),
      { dataTransfer },
    );
    expect(dataTransfer.setData).toHaveBeenCalledWith(
      "application/x-opendesign-image-asset-id",
      "asset_photo",
    );

    await user.type(searchInput, "not found");
    expect(screen.getByText("No matching images")).toBeInTheDocument();
    await user.clear(searchInput);
    await user.click(
      screen.getByRole("button", { name: "Import image asset" }),
    );
    expect(onImportAsset).toHaveBeenCalledTimes(1);

    await user.click(
      screen.getByRole("button", { name: "Actions for Campaign hero" }),
    );
    expect(
      screen.getByRole("menuitem", {
        name: "Delete unavailable · asset is in use",
      }),
    ).toHaveAttribute("data-disabled");
    expect(onDeleteAsset).not.toHaveBeenCalled();
  });
});
