import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import {
  DESIGN_DELIVERY_LEDGER_VERSION,
  ConversationDescriptorContract,
  ConversationDescriptorListContract,
  DesignTargetContract,
  GlobalTaskProjectionSchema,
  MAX_DESIGN_TARGETS,
  MAX_PROJECT_DESIGN_FILES,
  MAX_SELECTED_NODE_IDS,
  PROJECT_MANIFEST_VERSION,
  ProjectManifestContract,
  ProjectManifestSchema,
  ResourceLocatorSchema,
  ResourceLocatorContract,
  RootGrantContract,
  RootGrantSchema,
  RunAccessSnapshotContract,
  RunTargetSetContract,
  WORKSPACE_CONTRACT_VERSION,
  isDesignTarget,
  isDesignFileDescriptor,
  isDesignDeliveryLedger,
  normalizeDesignDeliveryLedger,
  normalizeGlobalTaskProjection,
  isGlobalTaskProjection,
  isNormalizedRelativePath,
  isProjectManifest,
  isResourceLocator,
  isRootGrant,
  isRunAccessSnapshot,
  isRunTargetSet,
  type DesignFileDescriptor,
  type DesignTarget,
  type ProjectManifest,
  type ResourceLocator,
  type RootGrant,
} from "./index.js";

const now = "2026-08-07T12:00:00.000Z";

function designFile(
  overrides: Partial<DesignFileDescriptor> = {},
): DesignFileDescriptor {
  return {
    designFileId: "design_file_1",
    documentId: "document_1",
    name: "Mobile UI",
    relativePath: "designs/mobile-ui.opendesign",
    createdAt: now,
    updatedAt: now,
    lifecycle: "active",
    ...overrides,
  };
}

function projectManifest(
  overrides: Partial<ProjectManifest> = {},
): ProjectManifest {
  return {
    manifestVersion: PROJECT_MANIFEST_VERSION,
    projectId: "project_home",
    name: "Product Design",
    createdAt: now,
    updatedAt: now,
    lifecycle: "active",
    designFiles: [designFile()],
    ...overrides,
  };
}

function designTarget(overrides: Partial<DesignTarget> = {}): DesignTarget {
  return {
    targetId: "target_1",
    projectId: "project_collaboration",
    designFileId: "design_file_1",
    documentId: "document_1",
    pageId: "page_1",
    frameId: "frame_1",
    selectedNodeIds: ["node_1", "node_2"],
    primaryNodeId: "node_1",
    baseRevision: 4,
    ...overrides,
  };
}

function rootGrant(overrides: Partial<RootGrant> = {}): RootGrant {
  return {
    version: WORKSPACE_CONTRACT_VERSION,
    rootGrantId: "grant_1",
    rootId: "root_1",
    name: "Shared assets",
    scope: { type: "project", projectId: "project_assets" },
    permissions: ["read", "write", "create"],
    discoverProjectConfig: false,
    lifecycle: "active",
    createdAt: now,
    ...overrides,
  };
}

function targetSet(targets: DesignTarget[] = [designTarget()]) {
  return {
    targets,
    primaryTarget: targets[0]!,
  };
}

function accessSnapshot() {
  return {
    version: WORKSPACE_CONTRACT_VERSION,
    snapshotId: "snapshot_1",
    runId: "run_1",
    conversationId: "conversation_1",
    capturedAt: now,
    targetSet: targetSet(),
    rootGrants: [rootGrant()],
    resources: [
      {
        referenceId: "reference_1",
        runId: "run_1",
        kind: "snapshot" as const,
        object: "file" as const,
        locator: {
          scheme: "root" as const,
          rootGrantId: "grant_1",
          relativePath: "brand/logos/mark.svg",
        },
        permissions: ["read" as const],
        contentHash: `sha256:${"a".repeat(64)}`,
      },
      {
        referenceId: "reference_2",
        runId: "run_1",
        kind: "live" as const,
        object: "directory" as const,
        locator: {
          scheme: "project" as const,
          projectId: "project_reference",
          relativePath: "research/screenshots",
        },
        permissions: ["read" as const],
      },
    ],
  };
}

describe("workspace contract schemas", () => {
  it("accepts empty and populated strict project manifests", () => {
    expect(isProjectManifest(projectManifest())).toBe(true);
    expect(isProjectManifest(projectManifest({ designFiles: [] }))).toBe(true);
    expect(
      Value.Check(ProjectManifestSchema, {
        ...projectManifest(),
        absolutePath: "/Users/person/product-design",
      }),
    ).toBe(false);
    expect(
      Value.Check(ProjectManifestSchema, {
        ...projectManifest(),
        conversations: [{ conversationId: "conversation_1" }],
      }),
    ).toBe(false);
    expect(
      Value.Check(ProjectManifestSchema, {
        ...projectManifest(),
        credentials: { token: "secret" },
      }),
    ).toBe(false);
  });

  it("enforces stable IDs, manifest limits, and descriptor uniqueness", () => {
    expect(
      isProjectManifest(
        projectManifest({
          projectId: "not a stable id",
        }),
      ),
    ).toBe(false);
    expect(
      isProjectManifest(
        projectManifest({
          designFiles: Array.from(
            { length: MAX_PROJECT_DESIGN_FILES + 1 },
            (_, index) =>
              designFile({
                designFileId: `design_${index}`,
                documentId: `document_${index}`,
                relativePath: `designs/${index}.opendesign`,
              }),
          ),
        }),
      ),
    ).toBe(false);

    const duplicateId = [
      designFile(),
      designFile({
        documentId: "document_2",
        relativePath: "designs/desktop.opendesign",
      }),
    ];
    const duplicateDocument = [
      designFile(),
      designFile({
        designFileId: "design_file_2",
        relativePath: "designs/desktop.opendesign",
      }),
    ];
    const duplicatePath = [
      designFile(),
      designFile({
        designFileId: "design_file_2",
        documentId: "document_2",
      }),
    ];

    expect(
      Value.Check(
        ProjectManifestSchema,
        projectManifest({ designFiles: duplicateId }),
      ),
    ).toBe(true);
    expect(
      isProjectManifest(projectManifest({ designFiles: duplicateId })),
    ).toBe(false);
    expect(
      isProjectManifest(projectManifest({ designFiles: duplicateDocument })),
    ).toBe(false);
    expect(
      isProjectManifest(projectManifest({ designFiles: duplicatePath })),
    ).toBe(false);
    expect(
      ProjectManifestContract.parse(
        projectManifest({ designFiles: duplicateId }),
      ),
    ).toMatchObject({
      ok: false,
      issues: [
        expect.objectContaining({
          code: "workspace.design_file_id_duplicate",
          path: "/designFiles/1/designFileId",
        }),
      ],
    });
  });

  it("accepts normalized nested POSIX paths and rejects unsafe paths", () => {
    expect(isNormalizedRelativePath("designs/mobile-ui.opendesign")).toBe(true);
    expect(isNormalizedRelativePath("mobile-ui.opendesign")).toBe(true);

    for (const path of [
      "",
      "/etc/passwd",
      "C:/Users/person/design.opendesign",
      "C:\\Users\\person\\design.opendesign",
      "\\\\server\\share\\design.opendesign",
      "../secret",
      "designs/../secret",
      "designs/./mobile-ui.opendesign",
      "designs//mobile-ui.opendesign",
      "designs/mobile-ui.opendesign/",
      "designs/\0mobile-ui.opendesign",
      "designs/mobile\nui.opendesign",
    ]) {
      expect(isNormalizedRelativePath(path), path).toBe(false);
    }
    expect(
      isDesignFileDescriptor(
        designFile({ relativePath: "designs/mobile-ui.json" }),
      ),
    ).toBe(false);
  });

  it("owns Conversation descriptor relationships and list identity", () => {
    const conversation = {
      conversationId: "conversation_1",
      originProjectId: "project_home",
      filedProjectId: "project_home",
      title: "Homepage exploration",
      createdAt: now,
      updatedAt: now,
      lifecycle: "active",
    } as const;
    expect(ConversationDescriptorContract.parse(conversation)).toMatchObject({
      ok: true,
    });
    expect(
      ConversationDescriptorContract.parse({
        ...conversation,
        title: "Homepage\nexploration",
      }),
    ).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ path: "/title" })],
    });
    expect(
      ConversationDescriptorContract.parse({
        ...conversation,
        updatedAt: "2026-08-07T11:59:59.000Z",
      }),
    ).toMatchObject({
      ok: false,
      issues: [
        expect.objectContaining({
          code: "conversation.timestamp_order_invalid",
          path: "/updatedAt",
        }),
      ],
    });
    expect(
      ConversationDescriptorListContract.parse([
        conversation,
        { ...conversation, title: "Duplicate" },
      ]),
    ).toMatchObject({
      ok: false,
      issues: [
        expect.objectContaining({
          code: "conversation.id_duplicate",
          path: "/1/conversationId",
        }),
      ],
    });
  });

  it("supports typed resource schemes without accepting bare paths", () => {
    const locators: ResourceLocator[] = [
      {
        scheme: "project",
        projectId: "project_1",
        relativePath: "assets/logo.svg",
      },
      {
        scheme: "root",
        rootGrantId: "grant_1",
        relativePath: "references/brief.pdf",
      },
      {
        scheme: "design",
        projectId: "project_1",
        designFileId: "design_1",
        documentId: "document_1",
      },
      { scheme: "asset", projectId: "project_1", assetId: "asset_1" },
      {
        scheme: "external",
        providerId: "provider_1",
        externalResourceId: "external_1",
      },
      {
        scheme: "export",
        projectId: "project_1",
        exportId: "export_1",
        relativePath: "exports/review.png",
      },
      { scheme: "system-font", fontId: "font_inter" },
    ];

    for (const locator of locators) {
      expect(isResourceLocator(locator), locator.scheme).toBe(true);
    }

    expect(Value.Check(ResourceLocatorSchema, "/tmp/brief.pdf")).toBe(false);
    expect(
      isResourceLocator({
        scheme: "project",
        projectId: "project_1",
        relativePath: "/tmp/brief.pdf",
      }),
    ).toBe(false);
    expect(
      ResourceLocatorContract.parse({
        scheme: "root",
        rootGrantId: "grant_1",
        relativePath: "references/../../secret",
      }),
    ).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ path: "/relativePath" })],
    });
    expect(
      isResourceLocator({
        scheme: "root",
        rootGrantId: "grant_1",
        relativePath: "references/../../secret",
      }),
    ).toBe(false);
    expect(
      Value.Check(ResourceLocatorSchema, {
        ...locators[0],
        absolutePath: "/tmp/brief.pdf",
      }),
    ).toBe(false);
  });

  it("enforces root grant permissions, policy, and lifecycle invariants", () => {
    expect(isRootGrant(rootGrant())).toBe(true);
    expect(
      isRootGrant(
        rootGrant({
          scope: {
            type: "conversation",
            conversationId: "conversation_1",
          },
        }),
      ),
    ).toBe(true);
    expect(
      Value.Check(RootGrantSchema, {
        ...rootGrant(),
        discoverProjectConfig: true,
      }),
    ).toBe(false);
    expect(
      Value.Check(RootGrantSchema, {
        ...rootGrant(),
        permissions: ["read", "read"],
      }),
    ).toBe(false);
    expect(isRootGrant(rootGrant({ lifecycle: "revoked" }))).toBe(false);
    expect(
      RootGrantContract.parse(rootGrant({ lifecycle: "revoked" })),
    ).toMatchObject({
      ok: false,
      issues: [
        expect.objectContaining({
          code: "workspace.revoked_grant_time_missing",
          path: "/revokedAt",
        }),
      ],
    });
    expect(
      isRootGrant(rootGrant({ lifecycle: "revoked", revokedAt: now })),
    ).toBe(true);
    expect(isRootGrant(rootGrant({ lifecycle: "expired" }))).toBe(false);
    expect(
      isRootGrant(rootGrant({ lifecycle: "expired", expiresAt: now })),
    ).toBe(true);
  });

  it("enforces target selection, per-file uniqueness, and primary membership", () => {
    const primaryMismatch = designTarget({ primaryNodeId: "node_elsewhere" });
    expect(Value.Check(ProjectManifestSchema, projectManifest())).toBe(true);
    expect(isDesignTarget(primaryMismatch)).toBe(false);
    expect(DesignTargetContract.parse(primaryMismatch)).toMatchObject({
      ok: false,
      issues: [
        expect.objectContaining({
          code: "workspace.primary_selection_invalid",
          path: "/primaryNodeId",
        }),
      ],
    });
    expect(
      isDesignTarget(
        designTarget({
          pageId: "agent_page_call_1|fc_provider_1_page",
          frameId: "frame/provider:result",
          selectedNodeIds: ["node|legacy"],
          primaryNodeId: "node|legacy",
        }),
      ),
    ).toBe(true);
    expect(
      isDesignTarget(designTarget({ selectedNodeIds: ["node\ncontrol"] })),
    ).toBe(false);
    expect(
      isDesignTarget({
        ...designTarget(),
        selectedNodeIds: Array.from(
          { length: MAX_SELECTED_NODE_IDS + 1 },
          (_, index) => `node_${index}`,
        ),
      }),
    ).toBe(false);

    const first = designTarget();
    const duplicateFile = designTarget({
      targetId: "target_2",
      documentId: "document_2",
      pageId: "page_2",
    });
    expect(isRunTargetSet(targetSet([first, duplicateFile]))).toBe(false);
    expect(
      RunTargetSetContract.parse(targetSet([first, duplicateFile])),
    ).toMatchObject({
      ok: false,
      issues: [
        expect.objectContaining({
          code: "workspace.target_design_file_duplicate",
          path: "/targets/1/designFileId",
        }),
      ],
    });

    const duplicateTargetId = designTarget({
      projectId: "project_elsewhere",
      designFileId: "design_elsewhere",
      documentId: "document_elsewhere",
    });
    expect(isRunTargetSet(targetSet([first, duplicateTargetId]))).toBe(false);

    expect(
      isRunTargetSet({
        targets: [first],
        primaryTarget: designTarget({ targetId: "target_elsewhere" }),
      }),
    ).toBe(false);
    expect(
      isRunTargetSet({
        targets: [first],
        primaryTarget: { ...first, baseRevision: first.baseRevision + 1 },
      }),
    ).toBe(false);
    expect(
      isRunTargetSet(
        targetSet(
          Array.from({ length: MAX_DESIGN_TARGETS + 1 }, (_, index) =>
            designTarget({
              targetId: `target_${index}`,
              projectId: `project_${index}`,
              designFileId: `design_${index}`,
              documentId: `document_${index}`,
            }),
          ),
        ),
      ),
    ).toBe(false);
  });

  it("keeps Conversation identity separate from target and access scope", () => {
    const snapshot = accessSnapshot();

    expect(snapshot.conversationId).toBe("conversation_1");
    expect(snapshot.targetSet.primaryTarget.projectId).toBe(
      "project_collaboration",
    );
    expect(snapshot.rootGrants[0]!.scope).toEqual({
      type: "project",
      projectId: "project_assets",
    });
    expect(isRunAccessSnapshot(snapshot)).toBe(true);
  });

  it("rejects inconsistent access snapshot references", () => {
    const snapshot = accessSnapshot();
    expect(
      isRunAccessSnapshot({
        ...snapshot,
        resources: [
          { ...snapshot.resources[0], runId: "run_elsewhere" },
          snapshot.resources[1],
        ],
      }),
    ).toBe(false);
    expect(
      RunAccessSnapshotContract.parse({
        ...snapshot,
        resources: [
          { ...snapshot.resources[0], runId: "run_elsewhere" },
          snapshot.resources[1],
        ],
      }),
    ).toMatchObject({
      ok: false,
      issues: [
        expect.objectContaining({
          code: "workspace.reference_run_mismatch",
          path: "/resources/0/runId",
        }),
      ],
    });
    expect(
      isRunAccessSnapshot({
        ...snapshot,
        resources: [
          snapshot.resources[0],
          { ...snapshot.resources[1], referenceId: "reference_1" },
        ],
      }),
    ).toBe(false);
    expect(
      isRunAccessSnapshot({
        ...snapshot,
        resources: [
          {
            ...snapshot.resources[0],
            locator: {
              scheme: "root",
              rootGrantId: "grant_missing",
              relativePath: "brand/logo.svg",
            },
          },
        ],
      }),
    ).toBe(false);
    expect(
      isRunAccessSnapshot({
        ...snapshot,
        rootGrants: [
          rootGrant({
            scope: {
              type: "conversation",
              conversationId: "conversation_elsewhere",
            },
          }),
        ],
      }),
    ).toBe(false);
    expect(
      isRunAccessSnapshot({
        ...snapshot,
        rootGrants: [rootGrant({ permissions: ["read"] })],
        resources: [
          {
            ...snapshot.resources[0],
            permissions: ["write"],
          },
        ],
      }),
    ).toBe(false);
  });

  it("validates all global task lifecycle states and strict projections", () => {
    const projection = {
      version: WORKSPACE_CONTRACT_VERSION,
      taskId: "task_1",
      conversationId: "conversation_1",
      runId: "run_1",
      title: "Refine the mobile design",
      lifecycle: "queued" as const,
      targetSet: targetSet(),
      createdAt: now,
      updatedAt: now,
    };
    const delivery = {
      version: DESIGN_DELIVERY_LEDGER_VERSION,
      targets: [
        {
          targetId: "target_home",
          label: "Home",
          pageId: "page_1",
          rootNodeId: "frame_home",
          reservedNodeIds: ["frame_home", "region_home"],
          status: "refined" as const,
          allocatedRevision: 1,
          draftRevision: 1,
          captureRevision: 1,
          reviewRevision: 1,
          refinementRevision: 2,
        },
        {
          targetId: "target_profile",
          label: "Profile",
          pageId: "page_1",
          rootNodeId: "frame_profile",
          reservedNodeIds: ["frame_profile", "region_profile"],
          status: "pending" as const,
        },
      ],
      activeTargetId: "target_home",
    };
    expect(isDesignDeliveryLedger(delivery)).toBe(true);
    expect(
      isDesignDeliveryLedger({
        ...delivery,
        targets: [
          {
            ...delivery.targets[0],
            pageId: "agent_page_call_1|fc_provider_1_page",
            rootNodeId: "frame|legacy",
            reservedNodeIds: ["frame|legacy", "region_home"],
          },
          delivery.targets[1],
        ],
      }),
    ).toBe(true);
    expect(
      isDesignDeliveryLedger({
        version: DESIGN_DELIVERY_LEDGER_VERSION,
        targets: [
          {
            targetId: "target_fast_mark",
            label: "Fast mark",
            pageId: "page_1",
            rootNodeId: "frame_fast_mark",
            reservedNodeIds: ["frame_fast_mark", "region_fast_mark"],
            status: "verified",
            allocatedRevision: 1,
            draftRevision: 2,
            captureRevision: 2,
            reviewRevision: 2,
            verifiedRevision: 2,
          },
        ],
        activeTargetId: null,
      }),
    ).toBe(true);
    expect(isGlobalTaskProjection({ ...projection, delivery })).toBe(true);
    expect(
      isDesignDeliveryLedger({
        ...delivery,
        targets: [
          { ...delivery.targets[0], reservedNodeIds: ["region_home"] },
          delivery.targets[1],
        ],
      }),
    ).toBe(false);
    expect(
      isDesignDeliveryLedger({
        ...delivery,
        targets: [
          delivery.targets[0],
          {
            ...delivery.targets[1],
            reservedNodeIds: ["frame_profile", "region_home"],
          },
        ],
      }),
    ).toBe(false);
    expect(
      isDesignDeliveryLedger({ ...delivery, activeTargetId: "target_missing" }),
    ).toBe(false);
    expect(
      isDesignDeliveryLedger({
        ...delivery,
        targets: [
          {
            ...delivery.targets[0],
            status: "verified",
            verifiedRevision: 3,
          },
          {
            ...delivery.targets[1],
            status: "verified",
            allocatedRevision: 2,
            draftRevision: 2,
            captureRevision: 2,
            reviewRevision: 2,
            refinementRevision: 3,
            verifiedRevision: 3,
          },
        ],
        activeTargetId: null,
      }),
    ).toBe(true);
    const lifecycles = [
      "queued",
      "running",
      "waiting_approval",
      "conflict",
      "completed",
      "cancelled",
      "failed",
      "interrupted",
      "needs_attention",
    ] as const;

    for (const lifecycle of lifecycles) {
      expect(
        isGlobalTaskProjection({ ...projection, lifecycle }),
        lifecycle,
      ).toBe(true);
    }
    expect(
      Value.Check(GlobalTaskProjectionSchema, {
        ...projection,
        internalState: "not-public",
      }),
    ).toBe(false);
    expect(isGlobalTaskProjection({ ...projection, lifecycle: "paused" })).toBe(
      false,
    );
  });

  it("upgrades persisted v1/v2 ledgers without inventing old Plan reservations", () => {
    const legacy = {
      version: 1,
      targets: [
        {
          targetId: "target_home",
          label: "Home",
          pageId: "page_1",
          rootNodeId: "frame_home",
          status: "drafted",
          draftRevision: 3,
        },
      ],
      activeTargetId: "target_home",
    };
    expect(isDesignDeliveryLedger(legacy)).toBe(false);
    expect(normalizeDesignDeliveryLedger(legacy)).toEqual({
      ...legacy,
      version: DESIGN_DELIVERY_LEDGER_VERSION,
      targets: [
        {
          ...legacy.targets[0],
          reservedNodeIds: ["frame_home"],
          allocatedRevision: 3,
        },
      ],
    });
    expect(
      normalizeDesignDeliveryLedger({
        ...legacy,
        version: 2,
        targets: [
          {
            ...legacy.targets[0],
            allocatedRevision: 2,
            draftRevision: 3,
          },
        ],
      }),
    ).toEqual({
      ...legacy,
      version: DESIGN_DELIVERY_LEDGER_VERSION,
      targets: [
        {
          ...legacy.targets[0],
          reservedNodeIds: ["frame_home"],
          allocatedRevision: 2,
          draftRevision: 3,
        },
      ],
    });
    const projection = {
      version: WORKSPACE_CONTRACT_VERSION,
      taskId: "task_legacy",
      conversationId: "conversation_1",
      runId: "run_legacy",
      title: "Legacy task",
      lifecycle: "interrupted",
      targetSet: targetSet(),
      delivery: legacy,
      createdAt: now,
      updatedAt: now,
    };
    expect(normalizeGlobalTaskProjection(projection)?.delivery).toEqual(
      normalizeDesignDeliveryLedger(legacy),
    );
  });
});
