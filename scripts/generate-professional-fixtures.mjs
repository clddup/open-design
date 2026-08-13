import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "prettier";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const checkOnly = process.argv.includes("--check");
const generatorPath = "scripts/generate-professional-fixtures.mjs";
const fixtureRoot = "fixtures/professional";
const fixtureVersion = 1;

const fixtureSources = [
  {
    id: "OD-PENGUIN-01",
    promptPath: `${fixtureRoot}/OD-PENGUIN-01/prompt.md`,
    build: buildPenguinFixture,
  },
  {
    id: "OD-POSTER-01",
    promptPath: `${fixtureRoot}/OD-POSTER-01/prompt.md`,
    build: buildPosterFixture,
  },
  {
    id: "OD-BRAND-01",
    promptPath: `${fixtureRoot}/OD-BRAND-01/prompt.md`,
    build: buildBrandFixture,
  },
];

const iconPath = "apps/desktop/build/icons/64x64.png";
const iconBytes = await readFile(join(root, iconPath));
const outputs = new Map();
const manifestFixtures = [];

for (const source of fixtureSources) {
  const prompt = await readFile(join(root, source.promptPath), "utf8");
  const built = source.build({
    iconBase64: iconBytes.toString("base64"),
    promptSha256: sha256(prompt),
  });
  const directory = `${fixtureRoot}/${source.id}`;
  const paths = {
    initialDocument: `${directory}/initial.opendesign`,
    refinementTransaction: `${directory}/refinement.transaction.json`,
    finalDocument: `${directory}/document.opendesign`,
  };
  const serialized = {
    initialDocument: await json(built.initialDocument),
    refinementTransaction: await json(built.refinementTransaction),
    finalDocument: await json(built.finalDocument),
  };
  outputs.set(paths.initialDocument, serialized.initialDocument);
  outputs.set(paths.refinementTransaction, serialized.refinementTransaction);
  outputs.set(paths.finalDocument, serialized.finalDocument);
  manifestFixtures.push({
    fixtureVersion,
    id: source.id,
    title: built.title,
    pageId: built.pageId,
    artboardId: built.artboardId,
    compositeGroupId: built.compositeGroupId,
    requiredPathNodeIds: built.requiredPathNodeIds,
    requiredBooleanNodeIds: built.requiredBooleanNodeIds,
    booleanExpectations: built.booleanExpectations,
    projectionExpectations: built.projectionExpectations,
    minimumFeatures: built.minimumFeatures,
    artboard: built.artboard,
    files: {
      prompt: artifact(source.promptPath, prompt),
      initialDocument: artifact(
        paths.initialDocument,
        serialized.initialDocument,
      ),
      refinementTransaction: artifact(
        paths.refinementTransaction,
        serialized.refinementTransaction,
      ),
      finalDocument: artifact(paths.finalDocument, serialized.finalDocument),
    },
    evidence: {
      structuralReplay: "automated",
      sceneProjection: "automated",
      pixelBaseline: "pending",
      liveAgentReplay: "pending",
      professionalExport: "pending",
      macos: "pending",
      windows: "pending",
    },
  });
}

const manifest = {
  version: 1,
  generatedBy: generatorPath,
  documentSchemaVersion: "1.12.0",
  engineBaseline: "leafer-editor@2.2.9",
  sourceAssets: [
    {
      path: iconPath,
      sha256: sha256(iconBytes),
      purpose: "Embedded image-layer projection evidence in OD-POSTER-01",
    },
  ],
  fixtures: manifestFixtures,
};
outputs.set(`${fixtureRoot}/manifest.json`, await json(manifest));

const drift = [];
for (const [relativePath, expected] of outputs) {
  const absolutePath = join(root, relativePath);
  if (checkOnly) {
    const actual = await readFile(absolutePath, "utf8").catch(() => null);
    if (actual !== expected) drift.push(relativePath);
    continue;
  }
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, expected, "utf8");
}

if (checkOnly && drift.length > 0) {
  throw new Error(
    `Professional fixture drift detected. Run pnpm fixtures:generate: ${drift.join(", ")}`,
  );
}

console.log(
  checkOnly
    ? `Professional fixtures are current (${outputs.size} generated files).`
    : `Generated ${outputs.size} professional fixture files.`,
);

function buildPenguinFixture({ promptSha256 }) {
  const pageId = "page_penguin_01";
  const artboardId = "penguin_artboard";
  const mascot = createPenguinNodes({
    prefix: "penguin",
    parentId: artboardId,
    groupName: "Orbit Penguin",
    transform: [1, 0, 0, 1, 170, 64],
  });
  const backgroundOrb = ellipse({
    id: "penguin_background_orb",
    name: "Ice halo",
    parentId: artboardId,
    transform: [1, 0, 0, 1, 90, 80],
    size: { width: 580, height: 580 },
    fills: [
      radialGradient([
        [0, "#56d8ff", 0.34],
        [0.55, "#7567ff", 0.12],
        [1, "#0b1024", 0],
      ]),
    ],
    effects: [{ type: "layer-blur", radius: 18 }],
    blendMode: "screen",
  });
  const caption = text({
    id: "penguin_caption",
    name: "Specimen caption",
    parentId: artboardId,
    transform: [1, 0, 0, 1, 170, 684],
    size: { width: 420, height: 36 },
    content: "ORBIT PENGUIN  /  VECTOR STUDY 01",
    fontSize: 14,
    fontWeight: 700,
    lineHeight: 20,
    letterSpacing: 2.4,
    fills: [solid("#b7c6f8", 0.84)],
    textAlignHorizontal: "center",
  });
  const artboard = frame({
    id: artboardId,
    name: "OD-PENGUIN-01 Artboard",
    parentId: null,
    childIds: [backgroundOrb.id, mascot.group.id, caption.id],
    transform: [1, 0, 0, 1, 0, 0],
    size: { width: 760, height: 760 },
    fills: [
      linearGradient(
        [
          [0, "#070b19", 1],
          [0.5, "#101a3a", 1],
          [1, "#080b16", 1],
        ],
        132,
      ),
      radialGradient([
        [0, "#344ed8", 0.34],
        [1, "#0b1024", 0],
      ]),
    ],
    cornerRadius: 32,
    clipsContent: true,
  });
  const initialDocument = document({
    documentId: "document_od_penguin_01",
    pageId,
    pageName: "Penguin",
    rootNodeIds: [artboardId],
    nodes: [artboard, backgroundOrb, mascot.group, ...mascot.children, caption],
    extensions: fixtureExtensions("OD-PENGUIN-01", promptSha256),
  });
  const refinementTransaction = transaction({
    transactionId: "fixture_penguin_refinement_01",
    documentId: initialDocument.documentId,
    commands: [
      {
        commandId: "pose_right_wing",
        type: "update_properties",
        nodeId: "penguin_wing_right",
        transform: [0.985, 0.12, -0.12, 0.985, 307, 166],
      },
      {
        commandId: "polish_scarf_tail",
        type: "update_properties",
        nodeId: "penguin_scarf_tail",
        effects: [
          dropShadow("#080b20", 0.52, 8, 18, 1),
          outerGlow("#ff5b86", 0.34, 18, 2),
        ],
      },
    ],
  });
  const finalDocument = applyFixtureRefinement(
    initialDocument,
    refinementTransaction,
  );

  return {
    title: "Orbit Penguin vector mascot",
    pageId,
    artboardId,
    compositeGroupId: mascot.group.id,
    requiredPathNodeIds: mascot.requiredPathNodeIds,
    requiredBooleanNodeIds: [],
    booleanExpectations: null,
    projectionExpectations: {
      gradientNodeId: "penguin_body",
      effectNodeId: "penguin_scarf_tail",
      maskNodeId: null,
      imageNodeId: null,
    },
    minimumFeatures: {
      paths: 11,
      gradients: 10,
      glows: 3,
      blurs: 2,
      blends: 2,
      masks: 0,
      images: 0,
      text: 1,
    },
    artboard: { width: 760, height: 760 },
    initialDocument,
    refinementTransaction,
    finalDocument,
  };
}

function buildPosterFixture({ iconBase64, promptSha256 }) {
  const pageId = "page_poster_01";
  const artboardId = "poster_artboard";
  const mascot = createPenguinNodes({
    prefix: "poster_penguin",
    parentId: artboardId,
    groupName: "Launch Penguin",
    transform: [0.92, 0, 0, 0.92, 870, 214],
  });
  const textureAsset = {
    id: "asset_poster_signal",
    kind: "image",
    name: "OpenDesign signal texture",
    mimeType: "image/png",
    source: { type: "data", value: iconBase64 },
    size: { width: 64, height: 64 },
    extensions: { fixtureSource: iconPath },
  };
  const texture = image({
    id: "poster_signal_image",
    name: "Signal image",
    parentId: artboardId,
    transform: [1, 0, 0, 1, 1238, 74],
    size: { width: 104, height: 104 },
    assetId: textureAsset.id,
    placement: { mode: "fit" },
    opacity: 0.34,
    blendMode: "screen",
    effects: [outerGlow("#6de8ff", 0.48, 30, 2)],
  });
  const atmosphere = group({
    id: "poster_atmosphere",
    name: "Atmosphere",
    parentId: artboardId,
    childIds: [
      "poster_orb_cyan",
      "poster_orb_magenta",
      "poster_aurora_mask",
      "poster_horizon",
      "poster_axis",
    ],
    transform: [1, 0, 0, 1, 0, 0],
    size: { width: 1440, height: 1024 },
  });
  const orbCyan = ellipse({
    id: "poster_orb_cyan",
    name: "Cyan atmosphere",
    parentId: atmosphere.id,
    transform: [1, 0, 0, 1, 820, -160],
    size: { width: 560, height: 560 },
    fills: [
      radialGradient([
        [0, "#32e7ff", 0.58],
        [0.52, "#1c75ff", 0.16],
        [1, "#081027", 0],
      ]),
    ],
    effects: [{ type: "layer-blur", radius: 46 }],
    blendMode: "screen",
  });
  const orbMagenta = ellipse({
    id: "poster_orb_magenta",
    name: "Magenta atmosphere",
    parentId: atmosphere.id,
    transform: [1, 0, 0, 1, -130, 650],
    size: { width: 500, height: 500 },
    fills: [
      radialGradient([
        [0, "#ff477e", 0.52],
        [0.5, "#8d3cff", 0.18],
        [1, "#090b1a", 0],
      ]),
    ],
    effects: [{ type: "layer-blur", radius: 54 }],
    blendMode: "screen",
  });
  const auroraMask = ellipse({
    id: "poster_aurora_mask",
    name: "Aurora luminance mask",
    parentId: atmosphere.id,
    transform: [1, 0, 0, 1, 748, 118],
    size: { width: 610, height: 730 },
    fills: [
      radialGradient([
        [0, "#ffffff", 0.3],
        [0.62, "#6de8ff", 0.08],
        [1, "#000000", 0],
      ]),
    ],
    maskMode: "luminance",
    blendMode: "screen",
  });
  const horizon = path({
    id: "poster_horizon",
    name: "Energy horizon",
    parentId: atmosphere.id,
    transform: [1, 0, 0, 1, 52, 650],
    size: { width: 1336, height: 220 },
    pathData: "M 0 178 C 220 52 420 216 650 96 C 850 -8 1020 158 1336 24",
    fills: [],
    strokes: [
      linearGradient(
        [
          [0, "#4eeaff", 0.08],
          [0.48, "#7af3ff", 0.92],
          [1, "#ff5d9e", 0.18],
        ],
        0,
      ),
    ],
    strokeWidth: 3,
    dashPattern: [18, 12],
    strokeCap: "round",
    effects: [outerGlow("#58e8ff", 0.62, 24, 1)],
    blendMode: "screen",
  });
  const axis = rectangle({
    id: "poster_axis",
    name: "Editorial axis",
    parentId: atmosphere.id,
    transform: [1, 0, 0, 1, 84, 88],
    size: { width: 3, height: 838 },
    fills: [
      linearGradient(
        [
          [0, "#7df0ff", 0.9],
          [0.52, "#7584ff", 0.34],
          [1, "#ff5d9e", 0.08],
        ],
        90,
      ),
    ],
    cornerRadius: 2,
  });
  const copy = group({
    id: "poster_copy",
    name: "Launch copy",
    parentId: artboardId,
    childIds: [
      "poster_kicker",
      "poster_title",
      "poster_subtitle",
      "poster_meta",
      "poster_chapter",
    ],
    transform: [1, 0, 0, 1, 0, 0],
    size: { width: 760, height: 760 },
  });
  const kicker = text({
    id: "poster_kicker",
    name: "Kicker",
    parentId: copy.id,
    transform: [1, 0, 0, 1, 122, 106],
    size: { width: 580, height: 32 },
    content: "OPEN DESIGN / NEW CREATIVE ORBIT",
    fontSize: 16,
    fontWeight: 700,
    lineHeight: 24,
    letterSpacing: 3.2,
    fills: [solid("#7cecff", 0.96)],
  });
  const title = text({
    id: "poster_title",
    name: "Hero title",
    parentId: copy.id,
    transform: [1, 0, 0, 1, 112, 172],
    size: { width: 650, height: 276 },
    content: "BEYOND\nTHE ICE",
    fontSize: 118,
    fontWeight: 900,
    lineHeight: 108,
    letterSpacing: -4.2,
    fills: [
      linearGradient(
        [
          [0, "#ffffff", 1],
          [0.46, "#bdefff", 1],
          [1, "#8e7cff", 1],
        ],
        118,
      ),
    ],
    strokes: [solid("#d9f7ff", 0.22)],
    strokeWidth: 1.5,
    effects: [
      dropShadow("#02040d", 0.62, 14, 34, 2),
      outerGlow("#5fe9ff", 0.2, 24, 0),
    ],
    opacity: 0.88,
  });
  const subtitle = text({
    id: "poster_subtitle",
    name: "Subtitle",
    parentId: copy.id,
    transform: [1, 0, 0, 1, 122, 492],
    size: { width: 570, height: 92 },
    content:
      "A new creative species lands where structured design meets generative intelligence.",
    fontSize: 25,
    fontWeight: 500,
    lineHeight: 36,
    letterSpacing: 0.2,
    fills: [solid("#c9d6ff", 0.78)],
  });
  const meta = text({
    id: "poster_meta",
    name: "Event metadata",
    parentId: copy.id,
    transform: [1, 0, 0, 1, 122, 632],
    size: { width: 580, height: 70 },
    content: "08.10 — 20:30  /  MAIN STAGE\nSHANGHAI · STREAMING WORLDWIDE",
    fontSize: 15,
    fontWeight: 700,
    lineHeight: 28,
    letterSpacing: 1.8,
    fills: [solid("#ffffff", 0.82)],
  });
  const chapter = text({
    id: "poster_chapter",
    name: "Chapter marker",
    parentId: copy.id,
    transform: [1, 0, 0, 1, 122, 770],
    size: { width: 560, height: 28 },
    content: "CHAPTER 01  /  A NEW CREATIVE SPECIES",
    fontSize: 12,
    fontWeight: 700,
    lineHeight: 20,
    letterSpacing: 2.1,
    fills: [solid("#ff77a8", 0.82)],
  });
  const footer = group({
    id: "poster_footer",
    name: "Footer",
    parentId: artboardId,
    childIds: ["poster_footer_rule", "poster_footer_text"],
    transform: [1, 0, 0, 1, 0, 0],
    size: { width: 1440, height: 1024 },
  });
  const footerRule = rectangle({
    id: "poster_footer_rule",
    name: "Footer rule",
    parentId: footer.id,
    transform: [1, 0, 0, 1, 122, 900],
    size: { width: 1196, height: 1 },
    fills: [solid("#bdefff", 0.28)],
    cornerRadius: 0,
  });
  const footerText = text({
    id: "poster_footer_text",
    name: "Footer caption",
    parentId: footer.id,
    transform: [1, 0, 0, 1, 122, 926],
    size: { width: 1196, height: 28 },
    content: "OD / 001     HUMAN DIRECTION × AGENT EXECUTION     1440 × 1024",
    fontSize: 12,
    fontWeight: 700,
    lineHeight: 20,
    letterSpacing: 2.3,
    fills: [solid("#9dacd9", 0.72)],
  });
  const artboard = frame({
    id: artboardId,
    name: "OD-POSTER-01 / 1440×1024",
    parentId: null,
    childIds: [atmosphere.id, texture.id, copy.id, mascot.group.id, footer.id],
    transform: [1, 0, 0, 1, 0, 0],
    size: { width: 1440, height: 1024 },
    fills: [
      linearGradient(
        [
          [0, "#050713", 1],
          [0.46, "#0e1734", 1],
          [1, "#090919", 1],
        ],
        128,
      ),
      angularGradient([
        [0, "#2731a8", 0.2],
        [0.5, "#00d8ff", 0.04],
        [1, "#ff3f91", 0.12],
      ]),
    ],
    cornerRadius: 0,
    clipsContent: true,
  });
  const nodes = [
    artboard,
    atmosphere,
    orbCyan,
    orbMagenta,
    auroraMask,
    horizon,
    axis,
    texture,
    copy,
    kicker,
    title,
    subtitle,
    meta,
    chapter,
    mascot.group,
    ...mascot.children,
    footer,
    footerRule,
    footerText,
  ];
  const initialDocument = document({
    documentId: "document_od_poster_01",
    pageId,
    pageName: "Poster",
    rootNodeIds: [artboardId],
    nodes,
    assets: [textureAsset],
    extensions: fixtureExtensions("OD-POSTER-01", promptSha256),
  });
  const refinementTransaction = transaction({
    transactionId: "fixture_poster_refinement_01",
    documentId: initialDocument.documentId,
    commands: [
      {
        commandId: "increase_title_contrast",
        type: "update_properties",
        nodeId: title.id,
        opacity: 1,
        effects: [
          dropShadow("#02040d", 0.7, 16, 38, 2),
          outerGlow("#5fe9ff", 0.3, 30, 0),
        ],
      },
      {
        commandId: "rebalance_mascot",
        type: "update_properties",
        nodeId: mascot.group.id,
        transform: [1, 0, 0, 1, 835, 176],
      },
      {
        commandId: "focus_horizon",
        type: "update_properties",
        nodeId: horizon.id,
        effects: [outerGlow("#58e8ff", 0.78, 30, 2)],
      },
    ],
  });
  const finalDocument = applyFixtureRefinement(
    initialDocument,
    refinementTransaction,
  );

  return {
    title: "Beyond the Ice launch poster",
    pageId,
    artboardId,
    compositeGroupId: mascot.group.id,
    requiredPathNodeIds: mascot.requiredPathNodeIds,
    requiredBooleanNodeIds: [],
    booleanExpectations: null,
    projectionExpectations: {
      gradientNodeId: title.id,
      effectNodeId: horizon.id,
      maskNodeId: auroraMask.id,
      imageNodeId: texture.id,
    },
    minimumFeatures: {
      paths: 12,
      gradients: 14,
      glows: 6,
      blurs: 3,
      blends: 6,
      masks: 1,
      images: 1,
      text: 6,
    },
    artboard: { width: 1440, height: 1024 },
    initialDocument,
    refinementTransaction,
    finalDocument,
  };
}

function buildBrandFixture({ promptSha256 }) {
  const pageId = "page_brand_01";
  const artboardId = "brand_artboard";
  const identityId = "brand_identity";
  const markId = "brand_mark";

  const atmosphere = ellipse({
    id: "brand_atmosphere",
    name: "Signal atmosphere",
    parentId: artboardId,
    transform: [1, 0, 0, 1, 38, 54],
    size: { width: 492, height: 492 },
    fills: [
      radialGradient([
        [0, "#5ee8ff", 0.26],
        [0.46, "#5568ff", 0.12],
        [1, "#080c1c", 0],
      ]),
    ],
    effects: [{ type: "layer-blur", radius: 34 }],
    blendMode: "screen",
  });
  const identity = group({
    id: identityId,
    name: "OpenDesign identity",
    parentId: artboardId,
    childIds: [markId, "brand_wordmark", "brand_descriptor", "brand_axis"],
    transform: [1, 0, 0, 1, 128, 150],
    size: { width: 704, height: 340 },
  });
  const mark = booleanNode({
    id: markId,
    name: "Open orbit / Boolean subtract",
    parentId: identityId,
    childIds: ["brand_mark_outer", "brand_mark_inner", "brand_mark_slot"],
    transform: [1, 0, 0, 1, 0, 0],
    size: { width: 280, height: 280 },
    operation: "subtract",
    fills: [
      angularGradient([
        [0, "#68efff", 1],
        [0.42, "#6677ff", 1],
        [0.78, "#c65cff", 1],
        [1, "#ff5f9e", 1],
      ]),
    ],
    strokes: [solid("#d9fbff", 0.48)],
    strokeWidth: 2,
    strokeAlign: "inside",
    effects: [
      dropShadow("#02040d", 0.62, 14, 30, 2),
      outerGlow("#61e9ff", 0.34, 24, 1),
    ],
  });
  const outer = path({
    id: "brand_mark_outer",
    name: "Outer signal / Path",
    parentId: markId,
    transform: [1, 0, 0, 1, 0, 0],
    size: { width: 280, height: 280 },
    pathData:
      "M 140 0 C 217 0 280 63 280 140 C 280 217 217 280 140 280 C 63 280 0 217 0 140 C 0 63 63 0 140 0 Z",
    fills: [solid("#ffffff", 1)],
  });
  const inner = ellipse({
    id: "brand_mark_inner",
    name: "Counter / Ellipse",
    parentId: markId,
    transform: [1, 0, 0, 1, 66, 66],
    size: { width: 148, height: 148 },
    fills: [solid("#ffffff", 1)],
  });
  const slot = path({
    id: "brand_mark_slot",
    name: "Optical opening / Path",
    parentId: markId,
    transform: [1, 0, 0, 1, 166, 92],
    size: { width: 126, height: 96 },
    pathData: "M 0 0 L 126 18 L 126 78 L 0 96 Z",
    fills: [solid("#ffffff", 1)],
  });
  const wordmark = text({
    id: "brand_wordmark",
    name: "OpenDesign wordmark",
    parentId: identityId,
    transform: [1, 0, 0, 1, 342, 62],
    size: { width: 362, height: 96 },
    content: "OPEN\nDESIGN",
    fontSize: 56,
    fontWeight: 900,
    lineHeight: 52,
    letterSpacing: -1.8,
    fills: [
      linearGradient(
        [
          [0, "#ffffff", 1],
          [0.52, "#d8efff", 1],
          [1, "#9baeff", 1],
        ],
        116,
      ),
    ],
    effects: [dropShadow("#02040d", 0.46, 8, 20, 1)],
  });
  const descriptor = text({
    id: "brand_descriptor",
    name: "Identity descriptor",
    parentId: identityId,
    transform: [1, 0, 0, 1, 346, 196],
    size: { width: 358, height: 44 },
    content: "AI-NATIVE CREATIVE SYSTEM",
    fontSize: 13,
    fontWeight: 700,
    lineHeight: 20,
    letterSpacing: 2.7,
    fills: [solid("#9fdff3", 0.84)],
  });
  const axis = path({
    id: "brand_axis",
    name: "Identity axis / Path",
    parentId: identityId,
    transform: [1, 0, 0, 1, 346, 260],
    size: { width: 334, height: 20 },
    pathData: "M 0 10 C 86 -2 216 22 334 6",
    fills: [],
    strokes: [
      linearGradient(
        [
          [0, "#64eaff", 0.16],
          [0.52, "#7786ff", 0.92],
          [1, "#ff62a3", 0.22],
        ],
        0,
      ),
    ],
    strokeWidth: 2,
    strokeCap: "round",
    effects: [outerGlow("#6ce9ff", 0.32, 14, 0)],
    blendMode: "screen",
  });
  const specimen = text({
    id: "brand_specimen",
    name: "Specimen reference",
    parentId: artboardId,
    transform: [1, 0, 0, 1, 128, 550],
    size: { width: 704, height: 26 },
    content: "OD-BRAND-01   /   NON-DESTRUCTIVE BOOLEAN MASTER",
    fontSize: 11,
    fontWeight: 700,
    lineHeight: 18,
    letterSpacing: 2.2,
    fills: [solid("#8493c5", 0.72)],
    textAlignHorizontal: "center",
  });
  const artboard = frame({
    id: artboardId,
    name: "OD-BRAND-01 / Master",
    parentId: null,
    childIds: [atmosphere.id, identity.id, specimen.id],
    transform: [1, 0, 0, 1, 0, 0],
    size: { width: 960, height: 640 },
    fills: [
      linearGradient(
        [
          [0, "#060914", 1],
          [0.5, "#101831", 1],
          [1, "#080a17", 1],
        ],
        132,
      ),
      radialGradient([
        [0, "#304bd4", 0.18],
        [1, "#080c1c", 0],
      ]),
    ],
    cornerRadius: 28,
    clipsContent: true,
  });
  const initialDocument = document({
    documentId: "document_od_brand_01",
    pageId,
    pageName: "Brand",
    rootNodeIds: [artboardId],
    nodes: [
      artboard,
      atmosphere,
      identity,
      mark,
      outer,
      inner,
      slot,
      wordmark,
      descriptor,
      axis,
      specimen,
    ],
    extensions: fixtureExtensions("OD-BRAND-01", promptSha256),
  });
  const refinementTransaction = transaction({
    transactionId: "fixture_brand_refinement_01",
    documentId: initialDocument.documentId,
    commands: [
      {
        commandId: "rebalance_optical_opening",
        type: "update_properties",
        nodeId: slot.id,
        transform: [1, 0, 0, 1, 158, 88],
        properties: { path: "M 0 0 L 134 20 L 134 76 L 0 96 Z" },
      },
      {
        commandId: "focus_mark_glow",
        type: "update_properties",
        nodeId: mark.id,
        effects: [
          dropShadow("#02040d", 0.68, 16, 34, 2),
          outerGlow("#61e9ff", 0.42, 28, 1),
        ],
      },
    ],
  });
  const finalDocument = applyFixtureRefinement(
    initialDocument,
    refinementTransaction,
  );

  return {
    title: "Open orbit brand identity",
    pageId,
    artboardId,
    compositeGroupId: identityId,
    requiredPathNodeIds: [outer.id, slot.id, axis.id],
    requiredBooleanNodeIds: [mark.id],
    booleanExpectations: {
      nodeId: mark.id,
      operation: "subtract",
      provider: "skia-pathkit",
      providerVersion: "1.0.0",
      resultBounds: {
        x: 0,
        y: 0,
        width: 277.5323486328125,
        height: 280,
      },
      resultPathSha256:
        "985abf56d945f33326936e41f59ea11f6f96ca20286344353ceb0a8da2132b9d",
    },
    projectionExpectations: {
      gradientNodeId: wordmark.id,
      effectNodeId: wordmark.id,
      maskNodeId: null,
      imageNodeId: null,
    },
    minimumFeatures: {
      paths: 3,
      gradients: 5,
      glows: 2,
      blurs: 1,
      blends: 2,
      masks: 0,
      images: 0,
      text: 3,
    },
    artboard: { width: 960, height: 640 },
    initialDocument,
    refinementTransaction,
    finalDocument,
  };
}

function createPenguinNodes({ prefix, parentId, groupName, transform }) {
  const id = (name) => `${prefix}_${name}`;
  const childIds = [
    id("halo"),
    id("foot_left"),
    id("foot_right"),
    id("scarf_tail"),
    id("wing_left"),
    id("wing_right"),
    id("body"),
    id("belly"),
    id("face"),
    id("eye_left"),
    id("eye_right"),
    id("pupil_left"),
    id("pupil_right"),
    id("highlight_left"),
    id("highlight_right"),
    id("beak"),
    id("scarf_band"),
    id("scarf_knot"),
  ];
  const groupNode = group({
    id: id("mascot"),
    name: groupName,
    parentId,
    childIds,
    transform,
    size: { width: 420, height: 570 },
  });
  const halo = ellipse({
    id: id("halo"),
    name: "Mascot aura",
    parentId: groupNode.id,
    transform: [1, 0, 0, 1, 18, 26],
    size: { width: 384, height: 520 },
    fills: [
      radialGradient([
        [0, "#64ecff", 0.26],
        [0.52, "#5865ff", 0.09],
        [1, "#0a0d20", 0],
      ]),
    ],
    effects: [{ type: "layer-blur", radius: 14 }],
    blendMode: "screen",
  });
  const footLeft = path({
    id: id("foot_left"),
    name: "Left foot / Path",
    parentId: groupNode.id,
    transform: [1, 0, 0, 1, 76, 474],
    size: { width: 126, height: 62 },
    pathData:
      "M 8 48 C 18 20 42 4 70 10 C 86 12 94 22 100 34 C 108 28 118 30 124 40 C 116 56 94 62 64 60 C 34 62 14 58 8 48 Z",
    fills: [
      linearGradient(
        [
          [0, "#ffd166", 1],
          [0.58, "#ff8a3d", 1],
          [1, "#e34d5b", 1],
        ],
        18,
      ),
    ],
    strokes: [solid("#ffcf75", 0.55)],
    strokeWidth: 2,
    effects: [dropShadow("#050713", 0.46, 8, 16, 1)],
  });
  const footRight = path({
    id: id("foot_right"),
    name: "Right foot / Path",
    parentId: groupNode.id,
    transform: [1, 0, 0, 1, 218, 474],
    size: { width: 126, height: 62 },
    pathData:
      "M 2 40 C 10 30 20 28 28 34 C 34 20 44 12 60 10 C 90 4 112 20 122 48 C 116 58 96 62 66 60 C 36 62 14 56 2 40 Z",
    fills: [
      linearGradient(
        [
          [0, "#e34d5b", 1],
          [0.42, "#ff8a3d", 1],
          [1, "#ffd166", 1],
        ],
        162,
      ),
    ],
    strokes: [solid("#ffcf75", 0.55)],
    strokeWidth: 2,
    effects: [dropShadow("#050713", 0.46, 8, 16, 1)],
  });
  const scarfTail = path({
    id: id("scarf_tail"),
    name: "Scarf tail / Path",
    parentId: groupNode.id,
    transform: [1, 0, 0, 1, 276, 278],
    size: { width: 124, height: 186 },
    pathData:
      "M 10 0 C 48 12 84 8 112 28 C 102 62 88 86 72 106 L 108 174 L 72 158 L 48 184 L 30 112 C 14 84 2 42 10 0 Z",
    fills: [
      linearGradient(
        [
          [0, "#ff4f87", 1],
          [0.48, "#ff6e66", 1],
          [1, "#ffb24e", 1],
        ],
        126,
      ),
    ],
    strokes: [solid("#ffd4dd", 0.42)],
    strokeWidth: 2,
    effects: [dropShadow("#080b20", 0.42, 6, 14, 1)],
  });
  const wingLeft = path({
    id: id("wing_left"),
    name: "Left wing / Path",
    parentId: groupNode.id,
    transform: [0.99, -0.08, 0.08, 0.99, 4, 174],
    size: { width: 122, height: 246 },
    pathData:
      "M 112 4 C 58 10 20 48 6 104 C -4 150 8 210 42 240 C 58 218 68 192 72 164 C 86 184 102 192 118 184 C 104 124 106 66 112 4 Z",
    fills: [
      linearGradient(
        [
          [0, "#172752", 1],
          [0.6, "#0a1028", 1],
          [1, "#03050c", 1],
        ],
        82,
      ),
    ],
    strokes: [solid("#5ce8ff", 0.22)],
    strokeWidth: 2,
    effects: [dropShadow("#02030a", 0.58, 8, 20, 1)],
  });
  const wingRight = path({
    id: id("wing_right"),
    name: "Right wing / Path",
    parentId: groupNode.id,
    transform: [0.99, 0.08, -0.08, 0.99, 304, 174],
    size: { width: 122, height: 246 },
    pathData:
      "M 10 4 C 64 10 102 48 116 104 C 126 150 114 210 80 240 C 64 218 54 192 50 164 C 36 184 20 192 4 184 C 18 124 16 66 10 4 Z",
    fills: [
      linearGradient(
        [
          [0, "#172752", 1],
          [0.6, "#0a1028", 1],
          [1, "#03050c", 1],
        ],
        98,
      ),
    ],
    strokes: [solid("#5ce8ff", 0.22)],
    strokeWidth: 2,
    effects: [dropShadow("#02030a", 0.58, 8, 20, 1)],
  });
  const body = path({
    id: id("body"),
    name: "Body / Path",
    parentId: groupNode.id,
    transform: [1, 0, 0, 1, 50, 42],
    size: { width: 320, height: 446 },
    pathData:
      "M 160 2 C 238 2 294 62 308 154 C 326 268 296 376 226 422 C 188 448 126 450 84 426 C 18 388 -8 282 10 174 C 26 76 80 2 160 2 Z",
    fills: [
      linearGradient(
        [
          [0, "#243968", 1],
          [0.42, "#0d1736", 1],
          [1, "#03050e", 1],
        ],
        138,
      ),
      radialGradient([
        [0, "#4be7ff", 0.18],
        [1, "#071022", 0],
      ]),
    ],
    strokes: [
      linearGradient(
        [
          [0, "#76efff", 0.56],
          [0.45, "#6f79ff", 0.18],
          [1, "#141c3e", 0.12],
        ],
        120,
      ),
    ],
    strokeWidth: 3,
    strokeJoin: "round",
    effects: [
      dropShadow("#01030a", 0.72, 16, 34, 4),
      outerGlow("#4bdfff", 0.2, 24, 1),
    ],
  });
  const belly = path({
    id: id("belly"),
    name: "Belly / Path",
    parentId: groupNode.id,
    transform: [1, 0, 0, 1, 92, 178],
    size: { width: 236, height: 266 },
    pathData:
      "M 118 0 C 180 0 224 58 232 134 C 240 202 204 258 118 264 C 34 258 -2 202 6 134 C 14 58 56 0 118 0 Z",
    fills: [
      linearGradient(
        [
          [0, "#f8fbff", 1],
          [0.56, "#dbeaff", 1],
          [1, "#9fc9e7", 1],
        ],
        112,
      ),
    ],
    strokes: [solid("#ffffff", 0.34)],
    strokeWidth: 2,
    effects: [
      {
        type: "inner-glow",
        color: "#79dfff",
        opacity: 0.22,
        radius: 18,
        spread: 0,
      },
    ],
  });
  const face = path({
    id: id("face"),
    name: "Face patch / Path",
    parentId: groupNode.id,
    transform: [1, 0, 0, 1, 80, 82],
    size: { width: 260, height: 160 },
    pathData:
      "M 130 10 C 174 -8 232 10 252 54 C 270 98 238 144 184 150 C 160 152 142 144 130 130 C 116 144 98 152 74 150 C 20 144 -12 98 8 54 C 28 10 84 -8 130 10 Z",
    fills: [
      linearGradient(
        [
          [0, "#f9fcff", 1],
          [1, "#cfe8fa", 1],
        ],
        104,
      ),
    ],
    strokes: [solid("#ffffff", 0.5)],
    strokeWidth: 2,
    effects: [dropShadow("#05102a", 0.28, 4, 14, 0)],
  });
  const eyeLeft = ellipse({
    id: id("eye_left"),
    name: "Left eye",
    parentId: groupNode.id,
    transform: [1, 0, 0, 1, 126, 116],
    size: { width: 56, height: 64 },
    fills: [solid("#ffffff", 1)],
    strokes: [solid("#9edfff", 0.5)],
    strokeWidth: 2,
  });
  const eyeRight = ellipse({
    id: id("eye_right"),
    name: "Right eye",
    parentId: groupNode.id,
    transform: [1, 0, 0, 1, 238, 116],
    size: { width: 56, height: 64 },
    fills: [solid("#ffffff", 1)],
    strokes: [solid("#9edfff", 0.5)],
    strokeWidth: 2,
  });
  const pupilLeft = ellipse({
    id: id("pupil_left"),
    name: "Left pupil",
    parentId: groupNode.id,
    transform: [1, 0, 0, 1, 144, 132],
    size: { width: 28, height: 36 },
    fills: [
      radialGradient([
        [0, "#2445a0", 1],
        [1, "#030610", 1],
      ]),
    ],
    effects: [outerGlow("#62dcff", 0.28, 8, 0)],
  });
  const pupilRight = ellipse({
    id: id("pupil_right"),
    name: "Right pupil",
    parentId: groupNode.id,
    transform: [1, 0, 0, 1, 248, 132],
    size: { width: 28, height: 36 },
    fills: [
      radialGradient([
        [0, "#2445a0", 1],
        [1, "#030610", 1],
      ]),
    ],
    effects: [outerGlow("#62dcff", 0.28, 8, 0)],
  });
  const highlightLeft = ellipse({
    id: id("highlight_left"),
    name: "Left eye light",
    parentId: groupNode.id,
    transform: [1, 0, 0, 1, 150, 136],
    size: { width: 9, height: 11 },
    fills: [solid("#ffffff", 0.96)],
  });
  const highlightRight = ellipse({
    id: id("highlight_right"),
    name: "Right eye light",
    parentId: groupNode.id,
    transform: [1, 0, 0, 1, 254, 136],
    size: { width: 9, height: 11 },
    fills: [solid("#ffffff", 0.96)],
  });
  const beak = path({
    id: id("beak"),
    name: "Beak / Path",
    parentId: groupNode.id,
    transform: [1, 0, 0, 1, 178, 176],
    size: { width: 64, height: 54 },
    pathData:
      "M 4 24 C 18 8 44 8 60 24 C 50 42 40 52 32 52 C 24 52 14 42 4 24 Z",
    fills: [
      linearGradient(
        [
          [0, "#ffd166", 1],
          [1, "#ff6b4a", 1],
        ],
        90,
      ),
    ],
    strokes: [solid("#fff0b2", 0.6)],
    strokeWidth: 1.5,
    effects: [dropShadow("#4b1430", 0.28, 3, 8, 0)],
  });
  const scarfBand = path({
    id: id("scarf_band"),
    name: "Scarf band / Path",
    parentId: groupNode.id,
    transform: [1, 0, 0, 1, 66, 244],
    size: { width: 290, height: 82 },
    pathData: "M 8 16 C 72 -2 220 -2 282 16 L 274 64 C 208 82 78 82 16 64 Z",
    fills: [
      linearGradient(
        [
          [0, "#ff3f82", 1],
          [0.52, "#ff6a65", 1],
          [1, "#ffb14a", 1],
        ],
        10,
      ),
    ],
    strokes: [solid("#ffd8e0", 0.46)],
    strokeWidth: 2,
    effects: [
      dropShadow("#06091a", 0.5, 8, 18, 1),
      outerGlow("#ff4f87", 0.26, 16, 1),
    ],
  });
  const scarfKnot = path({
    id: id("scarf_knot"),
    name: "Scarf knot / Path",
    parentId: groupNode.id,
    transform: [1, 0, 0, 1, 270, 248],
    size: { width: 82, height: 86 },
    pathData:
      "M 8 42 C 8 14 28 2 48 8 C 72 14 82 38 70 62 C 58 84 28 88 12 68 C 6 60 4 50 8 42 Z",
    fills: [
      angularGradient([
        [0, "#ff3f82", 1],
        [0.52, "#ff8d52", 1],
        [1, "#ffcf67", 1],
      ]),
    ],
    strokes: [solid("#ffe0e7", 0.42)],
    strokeWidth: 2,
    effects: [outerGlow("#ff5b86", 0.32, 14, 1)],
  });
  const children = [
    halo,
    footLeft,
    footRight,
    scarfTail,
    wingLeft,
    wingRight,
    body,
    belly,
    face,
    eyeLeft,
    eyeRight,
    pupilLeft,
    pupilRight,
    highlightLeft,
    highlightRight,
    beak,
    scarfBand,
    scarfKnot,
  ];
  return {
    group: groupNode,
    children,
    requiredPathNodeIds: [
      body.id,
      wingLeft.id,
      wingRight.id,
      footLeft.id,
      footRight.id,
      scarfBand.id,
      scarfKnot.id,
      scarfTail.id,
    ],
  };
}

function document({
  documentId,
  pageId,
  pageName,
  rootNodeIds,
  nodes,
  assets = [],
  extensions,
}) {
  return {
    format: "dev.opendesign.document",
    schemaVersion: "1.12.0",
    documentId,
    revision: 0,
    pageOrder: [pageId],
    pagesById: {
      [pageId]: { id: pageId, name: pageName, rootNodeIds, extensions: {} },
    },
    nodesById: Object.fromEntries(nodes.map((node) => [node.id, node])),
    componentsById: {},
    variantSetsById: {},
    tokenCollectionsById: {},
    tokensById: {},
    interactionsById: {},
    assetsById: Object.fromEntries(assets.map((asset) => [asset.id, asset])),
    extensions,
  };
}

function transaction({ transactionId, documentId, commands }) {
  return {
    transactionId,
    documentId,
    baseRevision: 0,
    actor: {
      type: "agent",
      id: "fixture-agent",
      displayName: "Professional fixture replay",
    },
    label: "Visual refinement",
    summary: "Recorded correction after the first visual inspection.",
    commands,
    extensions: { fixtureReplay: true },
  };
}

function applyFixtureRefinement(initialDocument, refinementTransaction) {
  const result = cloneJson(initialDocument);
  for (const command of refinementTransaction.commands) {
    if (command.type !== "update_properties") {
      throw new Error(`Fixture generator only supports update_properties`);
    }
    const node = result.nodesById[command.nodeId];
    if (!node) throw new Error(`Fixture node not found: ${command.nodeId}`);
    for (const [key, value] of Object.entries(command)) {
      if (key === "commandId" || key === "type" || key === "nodeId") continue;
      if (key === "properties") {
        node.properties = { ...node.properties, ...cloneJson(value) };
      } else if (key === "extensions") {
        node.extensions = { ...node.extensions, ...cloneJson(value) };
      } else {
        node[key] = cloneJson(value);
      }
    }
  }
  result.revision = 1;
  return result;
}

function fixtureExtensions(fixtureId, promptSha256) {
  return {
    fixture: {
      id: fixtureId,
      version: fixtureVersion,
      generator: generatorPath,
      promptSha256,
    },
  };
}

function nodeBase({
  id,
  kind,
  name,
  parentId,
  childIds = [],
  transform,
  size,
  opacity = 1,
  blendMode,
  effects,
  maskMode,
}) {
  return {
    id,
    kind,
    name,
    parentId,
    childIds,
    visible: true,
    locked: false,
    transform,
    size,
    opacity,
    ...(blendMode === undefined ? {} : { blendMode }),
    ...(effects === undefined ? {} : { effects }),
    ...(maskMode === undefined ? {} : { maskMode }),
    extensions: {},
  };
}

function frame({
  fills,
  strokes = [],
  strokeWidth = 0,
  cornerRadius,
  clipsContent,
  ...base
}) {
  return {
    ...nodeBase({ ...base, kind: "frame" }),
    properties: {
      fills,
      strokes,
      strokeWidth,
      cornerRadius,
      clipsContent,
    },
  };
}

function group(base) {
  return { ...nodeBase({ ...base, kind: "group" }), properties: {} };
}

function booleanNode({
  operation,
  fills,
  strokes = [],
  strokeWidth = 0,
  strokeAlign,
  strokeCap,
  strokeJoin,
  dashPattern,
  ...base
}) {
  return {
    ...nodeBase({ ...base, kind: "boolean" }),
    properties: shapeProperties({
      operation,
      fillRule: "nonzero",
      fills,
      strokes,
      strokeWidth,
      strokeAlign,
      strokeCap,
      strokeJoin,
      dashPattern,
    }),
  };
}

function rectangle({
  fills,
  strokes = [],
  strokeWidth = 0,
  cornerRadius,
  strokeAlign,
  strokeCap,
  strokeJoin,
  dashPattern,
  ...base
}) {
  return {
    ...nodeBase({ ...base, kind: "rectangle" }),
    properties: shapeProperties({
      fills,
      strokes,
      strokeWidth,
      cornerRadius,
      strokeAlign,
      strokeCap,
      strokeJoin,
      dashPattern,
    }),
  };
}

function ellipse({
  fills,
  strokes = [],
  strokeWidth = 0,
  strokeAlign,
  strokeCap,
  strokeJoin,
  dashPattern,
  ...base
}) {
  return {
    ...nodeBase({ ...base, kind: "ellipse" }),
    properties: shapeProperties({
      fills,
      strokes,
      strokeWidth,
      strokeAlign,
      strokeCap,
      strokeJoin,
      dashPattern,
    }),
  };
}

function path({
  pathData,
  fills,
  strokes = [],
  strokeWidth = 0,
  strokeAlign,
  strokeCap,
  strokeJoin,
  dashPattern,
  ...base
}) {
  return {
    ...nodeBase({ ...base, kind: "path" }),
    properties: shapeProperties({
      fills,
      strokes,
      strokeWidth,
      strokeAlign,
      strokeCap,
      strokeJoin,
      dashPattern,
      path: pathData,
      fillRule: "nonzero",
    }),
  };
}

function text({
  content,
  fontSize,
  fontWeight,
  lineHeight,
  letterSpacing,
  fills,
  strokes = [],
  strokeWidth = 0,
  textAlignHorizontal = "left",
  textAlignVertical = "top",
  textWrap = "word",
  textOverflow = "clip",
  textResize = "fixed",
  ...base
}) {
  return {
    ...nodeBase({ ...base, kind: "text" }),
    properties: shapeProperties({
      content,
      fontFamily: "Arial",
      fontSize,
      fontWeight,
      lineHeight,
      letterSpacing,
      textAlignHorizontal,
      textAlignVertical,
      textResize,
      textWrap,
      textOverflow,
      fills,
      strokes,
      strokeWidth,
    }),
  };
}

function image({
  assetId,
  placement,
  altText = "",
  cornerRadius = 0,
  ...base
}) {
  return {
    ...nodeBase({ ...base, kind: "image" }),
    properties: { assetId, placement, altText, cornerRadius },
  };
}

function shapeProperties(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  );
}

function solid(color, opacity = 1) {
  return { type: "solid", color, opacity };
}

function linearGradient(stops, rotation = 0) {
  return gradient("linear-gradient", stops, { rotation });
}

function radialGradient(stops) {
  return gradient("radial-gradient", stops);
}

function angularGradient(stops) {
  return gradient("angular-gradient", stops);
}

function gradient(type, stops, extra = {}) {
  return {
    type,
    opacity: 1,
    stops: stops.map(([offset, color, opacity]) => ({
      offset,
      color,
      opacity,
    })),
    ...extra,
  };
}

function dropShadow(color, opacity, offsetY, blur, spread) {
  return {
    type: "drop-shadow",
    color,
    opacity,
    offset: { x: 0, y: offsetY },
    blur,
    spread,
  };
}

function outerGlow(color, opacity, radius, spread) {
  return { type: "outer-glow", color, opacity, radius, spread };
}

function artifact(path, value) {
  return { path, sha256: sha256(value) };
}

function json(value) {
  return format(JSON.stringify(value), { parser: "json" });
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}
