import type { AgentToolFailureIssue } from "@opendesign/agent-contracts";
import { Type, type Static } from "@sinclair/typebox";
import { defineContract } from "./contract-validation";
import {
  DeliveryScopeContract,
  DESIGN_DELIVERY_SCOPE_TOOL_INPUT_SCHEMA,
} from "./design-delivery-scope";
import {
  DESIGN_GENERATION_TOOL_INPUT_SCHEMA,
  DesignGenerationContract,
} from "./design-generation-tool";
import { CaptureCanvasContract } from "./design-capture-tool";
import { DesignApplyContract } from "./design-apply-input";
import {
  DESIGN_BOOTSTRAP_EDIT_TOOL_INPUT_SCHEMA,
  DESIGN_CONTINUATION_EDIT_TOOL_INPUT_SCHEMA,
  DESIGN_EDIT_TOOL_INPUT_SCHEMA,
  EditDesignContract,
} from "./design-edit-tool";
import {
  DESIGN_CAPABILITIES_TOOL_NAME,
  DESIGN_CAPTURE_TOOL_NAME,
  DESIGN_SYSTEM_TOOL_NAME,
  DESIGN_DELIVERY_SCOPE_TOOL_NAME,
  DESIGN_EDIT_TOOL_NAME,
  DESIGN_GENERATION_TOOL_NAME,
  DESIGN_FONT_TOOL_NAME,
  DESIGN_INSPECT_TOOL_NAME,
  DESIGN_PAGE_TOOL_NAME,
  DESIGN_TEXT_RANGE_TOOL_NAME,
  DESIGN_VECTOR_TOOL_NAME,
  EXPORT_RASTER_TOOL_NAME,
  EXPORT_SVG_TOOL_NAME,
  EDIT_IMAGE_TOOL_NAME,
  GENERATE_IMAGE_TOOL_NAME,
  IMPORT_SVG_TOOL_NAME,
  INTERNAL_DESIGN_APPLY_TOOL_NAME,
  INTERNAL_DESIGN_COMPONENT_TOOL_NAME,
  INTERNAL_DESIGN_STYLE_TOOL_NAME,
  INTERNAL_DESIGN_VARIABLE_TOOL_NAME,
  INTERNAL_IMPORT_SVG_TOOL_NAME,
  INTERNAL_READ_IMAGE_SOURCE_TOOL_NAME,
  INTERNAL_UPDATE_IMAGE_TOOL_NAME,
  PAGE_STRUCTURE_ACCESS_TOOL_NAME,
  PLACE_IMAGE_TOOL_NAME,
  READ_IMAGE_TOOL_NAME,
  UPDATE_IMAGE_TOOL_NAME,
} from "./design-agent-tool-names";
import {
  EditImageContract,
  GenerateImageContract,
  GENERATE_IMAGE_TOOL_INPUT_SCHEMA,
  EDIT_IMAGE_TOOL_INPUT_SCHEMA,
  PlaceImageContract,
  PLACE_IMAGE_TOOL_INPUT_SCHEMA,
  READ_IMAGE_TOOL_INPUT_SCHEMA,
  ReadImageContract,
  UpdateImageContract,
  UPDATE_IMAGE_TOOL_INPUT_SCHEMA,
} from "./design-agent-image-tools";
import {
  InternalReadImageSourceContract,
  InternalUpdateImageContract,
} from "./design-agent-internal-image-tools";
import {
  ExportRasterContract,
  ExportSvgContract,
  EXPORT_RASTER_TOOL_INPUT_SCHEMA,
  EXPORT_SVG_TOOL_INPUT_SCHEMA,
  InternalImportSvgContract,
  ImportSvgContract,
  IMPORT_SVG_TOOL_INPUT_SCHEMA,
} from "./design-agent-import-export-tools";
import {
  DesignVectorContract,
  DESIGN_VECTOR_TOOL_INPUT_SCHEMA,
} from "./design-agent-structure-tools";
import {
  DesignFontContract,
  DesignTextRangeContract,
  DESIGN_FONT_TOOL_INPUT_SCHEMA,
  DESIGN_TEXT_RANGE_TOOL_INPUT_SCHEMA,
} from "./design-agent-typography-tools";
import {
  DesignPageContract,
  DESIGN_PAGE_TOOL_INPUT_SCHEMA,
  PageStructureAccessContract,
  PAGE_STRUCTURE_ACCESS_TOOL_INPUT_SCHEMA,
} from "./design-agent-document-tools";
import { DesignComponentContract } from "./design-component-tool";
import { DesignVariableContract } from "./design-variable-tool";
import { DesignStyleContract } from "./design-style-tool";
import {
  DesignSystemContract,
  DESIGN_SYSTEM_CONTINUATION_INPUT_SCHEMA,
  DESIGN_SYSTEM_TOOL_INPUT_SCHEMA,
} from "./design-system-tool";

const EMPTY_DESIGN_TOOL_INPUT_SCHEMA = Type.Object(
  {},
  { additionalProperties: false },
);
const EmptyDesignToolInputContract = defineContract<
  Static<typeof EMPTY_DESIGN_TOOL_INPUT_SCHEMA>
>({
  schema: EMPTY_DESIGN_TOOL_INPUT_SCHEMA,
  code: "design_tool.empty_input_invalid",
  subject: "Design tool input",
  clone: false,
});

const TOOL_DESCRIPTORS = [
  {
    name: DESIGN_DELIVERY_SCOPE_TOOL_NAME,
    modelDisclosure: {
      bootstrap: "available" as const,

      role: "delivery-scope" as const,
    },
    description:
      "Before generating a true multi-target composition, record its complete user-visible artboard scope once. Do not call this for a focused one-target Logo, screen, poster, or other asset; generate that target directly. In a product brief, a target is an actual separately rendered screen, logo direction, or requested visual asset—not a user flow, requirement heading, state transition, section, component, or implementation task. Put flows and states into the requiredContent of the artboards that visibly represent them unless the user explicitly requests each state as a separate delivered artboard. Use the brief's real deliverables rather than prompt length, attachment count, or a representative sample. Every target includes its intended real width and height. Delivery targets are not document Pages: keep a product suite on the current Page and create one Frame/Artboard per target. Include concise required content, exclusions, and assumptions. The host records stable target identities and non-overlapping geometry without writing empty Frames. Each Frame is created atomically with meaningful editable content when that target becomes active. Page creation and cross-Page organization are separate explicit lifecycle operations and are never inferred from target count. Focused edits to existing content do not call this tool.",
    inputSchema: DESIGN_DELIVERY_SCOPE_TOOL_INPUT_SCHEMA,
    risk: "design_write" as const,
    approval: "never" as const,
    validateInputIssues: (input: unknown) =>
      DeliveryScopeContract.issues(input),
  },
  {
    name: DESIGN_GENERATION_TOOL_NAME,
    modelDisclosure: {
      bootstrap: "available" as const,
      continuation: "available" as const,
      role: "material-write" as const,
    },
    description:
      "Generate the current target's real artboard and one coherent batch of meaningful editable content in a rollback-safe call. The revision is committed and rendered immediately; capture and independent review run only when you explicitly call opendesign_capture_canvas after the implementation is ready. For a larger target, stop this call once one complete, useful visual section is ready, then continue with ordinary edit calls; do not serialize the entire finished design before the canvas can update. For reviewed multi-target scope, generate deliveryStage.nextTarget when ready to start another artboard; unfinished review does not block that choice. Submit the requested artboard width/height, raster roles and one parent-first named element hierarchy; omit parentId for top-level artboard children. designIntent and visualSystem are optional concise execution hints; omit them rather than repeating the user's brief or inventing rationale. Main binds the target/Page/Frame identity, placement, objective, skills, fidelity, and component defaults; do not echo those fields or invent stage metadata. Declare referenceStrategy for approved reference images you actually use. For UI, optionally provide targets[].qualityProfile with the intended platform, safe-area insets, and call-local foreground/hit-area IDs; omitted IDs mean those checks are not evaluated, not passed. When real subject evidence is essential, call opendesign_generate_image first and use its persistent assetId in an image element in this generation call instead of committing a geometric placeholder. The content must visibly prove a brief-specific design decision, not retrofit reasons to generic primitives. That decision may be structural, typographic, behavioral, material, or geometric; never default to concentric rings, light beams, HUD decoration, gradient blocks, or stacked rectangles as shorthand for “cool” or “technology”. Use canonical document fills/strokes, blend modes, shadows and blur only when they serve the chosen form. Keep each batch within the shared DesignTransaction safety limit without degrading visual quality; split only at a coherent visual boundary and continue after the committed revision. Element IDs remain call-local, and Main binds those IDs to the Run namespace. When the user requests multiple Logo directions, author genuinely independent form hypotheses under one shared brand invariant; apply each direction's brief-specific primary color treatment and do not create uniformly scaled evidence clones. Later selected Logo/App Icon targets perform real optical redraws. Path commands use node-local coordinates and are not rescaled by width/height. Use one inspected Page, parent-local geometry, and exact fonts. After the hierarchy exists, inspect it and promote justified roots to Components through the disclosed design-system tool, matching Figma's create-component-from-node workflow; continuation keeps ordinary editing tools available with complete node appearance and contour editing.",
    inputSchema: DESIGN_GENERATION_TOOL_INPUT_SCHEMA,
    risk: "design_write" as const,
    approval: "never" as const,
    validateInputIssues: DesignGenerationContract.modelIssues,
  },
  {
    name: DESIGN_CAPABILITIES_TOOL_NAME,
    modelDisclosure: {
      bootstrap: "deferred" as const,
      afterInspection: "available" as const,
      continuation: "available" as const,
      role: "capability-discovery" as const,
    },
    description:
      "Read the trusted OpenDesign capability manifest and tool catalog. Set tools to the exact registered tool names whose complete schemas you need for the next response. Selection replaces the previous professional tool selection; an empty list returns to the basic tools. Omit tools to inspect capabilities without changing selection. Basic tools stay available. Requesting a schema does not grant Page, file, network, or write permissions. You can also request a basic tool such as opendesign_edit_design to see its complete operation schema.",
    risk: "read" as const,
    approval: "never" as const,
  },
  {
    name: DESIGN_INSPECT_TOOL_NAME,
    modelDisclosure: {
      bootstrap: "available" as const,
      continuation: "available" as const,
      role: "inspection" as const,
    },
    description:
      "Read the currently bound OpenDesign Design File, active Page, node tree, referenced asset metadata, selection, revision, a Run-scoped idAllocation.newNodeIdPrefix, and bounded structural/render diagnostics before planning a design change. Every newly authored document entity ID must start with that exact prefix because Node IDs are Design File-global even when Page-scoped inspection hides other Pages; existing IDs remain unchanged. Diagnostics identify empty paths/text, invisible nodes, missing assets, non-finite or clipped-out bounds, root-layer fragmentation, and actual Path/gradient/glow/blur/blend/mask/image/text usage. Asset source bytes and URIs are intentionally omitted; use opendesign_capture_canvas for bounded visual inspection. This does not inspect project files, source code, directories, or other Design Files. Call this instead of guessing canvas structure.",
    inputSchema: EMPTY_DESIGN_TOOL_INPUT_SCHEMA,
    risk: "read" as const,
    approval: "never" as const,
    validateInputIssues: EmptyDesignToolInputContract.issues,
  },
  {
    name: DESIGN_CAPTURE_TOOL_NAME,
    modelDisclosure: {
      bootstrap: "deferred" as const,
      continuation: "available" as const,
    },
    description:
      "Capture and independently review an exact revision in the Run-bound Design File. Omit target to capture the current generated artboard or bound Page. To review any existing artboard, including work from earlier messages, pass target.frameId from the current inspection and its deliverable; no Plan or new write is required. Main validates the Frame against the current scope. Optionally provide its actual UI qualityProfile and authorized referenceAttachmentIds; missing safe-area/interactive semantics mean those checks were not evaluated, not that they passed. The result includes a bounded multimodal image, observedRevision, layoutQuality for Frames, and reviewWorkflow containing actual findings. Use the findings to decide edits, another review, or your reply. Main preserves committed content when review is unavailable. Reinspect after a revision conflict; do not redraw a successful design because review failed. Capture is isolated from pan, zoom, selection and other windows; it cannot read other applications or arbitrary files.",
    inputSchema: CaptureCanvasContract.schema,
    risk: "read" as const,
    approval: "never" as const,
    validateInputIssues: CaptureCanvasContract.issues,
  },
  {
    name: READ_IMAGE_TOOL_NAME,
    modelDisclosure: {
      bootstrap: "available" as const,
      continuation: "available" as const,
    },
    description:
      "Read an image that the user explicitly referenced in the current prompt or attached to the current run. source must be the exact attachment ID, absolute local path, file URL, or HTTP(S) image URL written by the user. The host resolves it as a bounded, content-addressed image attachment and returns multimodal content. This tool cannot enumerate directories, discover neighboring files, use browser cookies, or read an unmentioned source.",
    inputSchema: READ_IMAGE_TOOL_INPUT_SCHEMA,
    risk: "read" as const,
    approval: "never" as const,
    validateInputIssues: ReadImageContract.issues,
  },
  {
    name: GENERATE_IMAGE_TOOL_NAME,
    modelDisclosure: {
      bootstrap: "available" as const,
      continuation: "available" as const,
    },
    description:
      "Generate one original raster image with OpenDesign's globally configured image-generation model whenever real subject evidence, photography, texture, or illustration materially improves the requested design. The result is staged immediately as a persistent current-Design-File asset and returned with an assetId that can be used by the design-generation image element in the same Provider turn. This selection is application-wide and independent of the current conversation model. The tool never accepts a provider or model ID and fails explicitly when no global image-generation model is configured.",
    inputSchema: GENERATE_IMAGE_TOOL_INPUT_SCHEMA,
    risk: "external" as const,
    approval: "never" as const,
    validateInputIssues: GenerateImageContract.issues,
  },
  {
    name: PLACE_IMAGE_TOOL_NAME,
    modelDisclosure: {
      bootstrap: "deferred" as const,
      continuation: "available" as const,
      role: "material-write" as const,
    },
    description:
      "Place either an image attachment authorized by this Conversation or a persistent assetId returned by current Design File inspection. Supply exactly one source. A successful design plan must declare the image role. Existing assetId placement requires explicit width and height. Editable posters must first create their planned artboard Frame with meaningful editable shape/text content, then place the image inside that existing Frame or one of its inspected/current descendants; parentId may never be null for this flow. Do not copy attachmentId into image assetId. Editable posters cannot use final-single-image. The host inserts one image node through the same atomic OpenDesign transaction and revision history as every other design edit.",
    inputSchema: PLACE_IMAGE_TOOL_INPUT_SCHEMA,
    risk: "design_write" as const,
    approval: "never" as const,
    validateInputIssues: PlaceImageContract.issues,
  },
  {
    name: UPDATE_IMAGE_TOOL_NAME,
    modelDisclosure: {
      bootstrap: "deferred" as const,
      role: "material-write" as const,
    },
    description:
      "Update existing image content through OpenDesign's non-destructive image workflow. set-placement and set-filters target an Image node. set-paint-filters targets one exact image Fill or Stroke using the inspected paintField, paintIndex, and complete expectedPaint so concurrent paint reordering or mutation fails closed; it never rewrites a guessed paint list. Both filter actions apply sparse exposure, contrast, saturation, temperature, tint, highlights, and shadows values in the -1..1 range; missing fields are neutral and an empty object resets all adjustments. replace-source consumes an image attachment already authorized for this run, creates a new durable content-addressed asset and a recoverable source-family derivation, preserves placement and filters unless replacements are supplied, and atomically updates the Image node. switch-source changes the node to an existing asset in the inspected source family and requires expectedAssetId so stale requests fail closed. Targets are explicit Page and node IDs returned by inspection, never the live selection. This tool does not perform pixel generation, inpainting, background removal, or destructive file edits.",
    inputSchema: UPDATE_IMAGE_TOOL_INPUT_SCHEMA,
    risk: "design_write" as const,
    approval: "never" as const,
    validateInputIssues: UpdateImageContract.issues,
  },
  {
    name: EDIT_IMAGE_TOOL_NAME,
    modelDisclosure: {
      bootstrap: "deferred" as const,
      role: "material-write" as const,
    },
    description:
      "Apply a trusted AI image edit to one inspected Image node. remove-background preserves the foreground subject as a transparent PNG; replace-background accepts only a description of the new background while the host adds the foreground-preservation instruction; relight accepts one provider-independent lightingPreset and preserves scene content while recomputing illumination; prompt-edit transforms the whole image with at most one authorized reference; erase-object removes a normalized source-image lasso; isolate-object creates a transparent sibling Image layer using a fresh resultNodeId; expand extends explicit node-local edges and grows the existing Image layer without moving its protected source region; upscale increases source pixel density while preserving node geometry and placement. pageId, nodeId, expectedAssetId, lasso, and expansion geometry must come from current inspection/capture. Do not provide masks, image bytes, paths, scale, provider, or model settings. The host creates and validates provider inputs and upscale dimensions, then atomically commits result assets, provenance, source history, and the exact node/layer change only if the target is still current. Cancellation, provider failure, invalid output, unsupported source geometry, or stale targets produce no revision.",
    inputSchema: EDIT_IMAGE_TOOL_INPUT_SCHEMA,
    risk: "external" as const,
    approval: "never" as const,
    validateInputIssues: EditImageContract.issues,
  },
  {
    name: IMPORT_SVG_TOOL_NAME,
    modelDisclosure: {
      bootstrap: "deferred" as const,
      role: "material-write" as const,
    },
    description:
      "Import one SVG attachment explicitly authorized by this Conversation as an editable OpenDesign vector tree of supported layers. The supported subset preserves Frame/Group hierarchy, basic vectors, gradients, rounded Frame clipping, ordered sibling masks, and bounded filter effects; unsupported semantics return explicit fidelity issues. attachmentId must be a content-addressed svg_<sha256> handle shown in the user's attachment metadata; SVG XML and local paths are never accepted. pageId, parentId, and index must be stable targets returned by opendesign_inspect_document. x and y place the imported SVG's top-left corner in the local coordinate system of that Page root, Frame, or Group. The tool never reads the live user selection or viewport. Main materializes the authorized SVG only after validation, Renderer parses it in the same cancellable SVG worker as manual import, and the host previews and applies one atomic undoable EditorRuntime transaction, selects the imported root, and reports explicit fidelity issues.",
    inputSchema: IMPORT_SVG_TOOL_INPUT_SCHEMA,
    risk: "design_write" as const,
    approval: "never" as const,
    validateInputIssues: ImportSvgContract.issues,
  },
  {
    name: EXPORT_SVG_TOOL_NAME,
    modelDisclosure: {
      bootstrap: "deferred" as const,
      afterInspection: "available" as const,
    },
    description:
      "Export explicit existing layers from the currently bound Design File as one SVG through OpenDesign's versioned interchange service. The supported subset preserves Frame/Group hierarchy, basic vectors, gradients, rounded Frame clipping, ordered sibling masks, and bounded filter effects. pageId and rootNodeIds must be stable IDs returned by opendesign_inspect_document; the tool never reads the live user selection. It freezes the current revision, resolves Boolean geometry in a cancellable Renderer worker, reports fidelity limitations, and opens the native save dialog owned by Main. Call this only when the user explicitly asks to export or deliver SVG. The user chooses or cancels the destination; the model never receives a local path. Only implemented includeLayerIds and padding settings are exposed. Text, images, unsupported effects or combined mask graphs, angular gradients, multiple paints, inside/outside strokes, and Boolean source operands may be rejected, omitted, or flattened with explicit fidelity notes.",
    inputSchema: EXPORT_SVG_TOOL_INPUT_SCHEMA,
    risk: "external" as const,
    approval: "never" as const,
    validateInputIssues: ExportSvgContract.issues,
  },
  {
    name: EXPORT_RASTER_TOOL_NAME,
    modelDisclosure: {
      bootstrap: "deferred" as const,
      afterInspection: "available" as const,
    },
    description:
      "Export one explicit existing layer or Frame from the currently bound Design File as a delivery-quality PNG, JPEG, or WebP. pageId and rootNodeId must be stable IDs returned by opendesign_inspect_document; this tool never reads the live user selection or viewport. It freezes the current revision, renders an isolated Leafer projection with explicit 1x/2x/3x or fixed width/height, background, quality, and resampling settings, then opens Main's native save dialog. The user chooses or cancels the destination; the model never receives bytes or a local path. Call only when the user explicitly asks to export or deliver a raster image. opendesign_capture_canvas is a bounded review preview and must not be presented as the exported artifact.",
    inputSchema: EXPORT_RASTER_TOOL_INPUT_SCHEMA,
    risk: "external" as const,
    approval: "never" as const,
    validateInputIssues: ExportRasterContract.issues,
  },
  {
    name: DESIGN_EDIT_TOOL_NAME,
    modelDisclosure: {
      bootstrap: "deferred" as const,
      afterInspection: "available" as const,

      continuation: "available" as const,
      role: "material-write" as const,

      bootstrapDescription:
        "Perform one coherent inspected node edit inside the active Run target. Use one node edit entry; it supports editable Path contours, gradients and effects as well as insert, property update, move and delete. Existing content remains editable whether or not a Plan created it; matching material revisions update the Plan ledger when one is active. New artboard roots still use opendesign_generate_design. After a material revision, this same tool adds compact layout repair without changing tool names.",
      bootstrapInputSchema: DESIGN_BOOTSTRAP_EDIT_TOOL_INPUT_SCHEMA,
      continuationDescription:
        "Continue the current design with complete node appearance and contour edits plus compact visual layout repair. Rebuild weak silhouettes with editable Paths instead of falling back to generic circles and rectangles. Use align, distribute, spacing, repair-overflow, resize-frame, or Page/Frame ruler guides when the inspected document requires them; keep writes inside the active Run target. Existing content remains editable after review or verification, and a successful revision invalidates stale capture evidence instead of requiring a new Plan.",
      continuationInputSchema: DESIGN_CONTINUATION_EDIT_TOOL_INPUT_SCHEMA,
    },
    description:
      "Edit the current OpenDesign document through one ordered atomic operation. Combine one direct node transaction with related hierarchy or layout edits when they belong together; the host projects every edit in order, routes hierarchy and arrangement through the existing Figma-style planners, then commits the complete command set as one revision and one undo step. Node edits support insert, property update, move, delete, and subtree replacement, including properties.network for editable vectors and exact imported SVG path data; never provide path and network together. Text node edits use the trusted provider that measures Auto Size and derived ending ellipsis. Hierarchy edits support group/ungroup, masks, Boolean groups, sibling order, and reparent while preserving world geometry. Arrange edits support host-computed geometry for alignment, distribution, spacing, two-dimensional Tidy up, persistent rotation origin, responsive Frame resize, Constraints v1, Auto gap, linear/Wrap/Grid Auto Layout, first-line baseline, Fill child's minimum width, stretched rows, counterAxisAlignContent, min/max clamping, absolute child positioning, Grid placement/track order, Layout Guides, Page/Frame ruler guides, and overflow repair. Smart Selection canvas handles remain a human canvas surface. Use stable IDs from inspection, keep edits inside the Run-authorized scope, and order dependent edits exactly as they should execute. An independent node edit on an unrelated existing artboard does not advance the current delivery Plan. Do not calculate planner-owned transforms or derived layout geometry yourself. Component, Style, Variable, Vector, typography, image, Page lifecycle/rename, and export semantics remain dedicated tools.",
    inputSchema: DESIGN_EDIT_TOOL_INPUT_SCHEMA,
    risk: "design_write" as const,
    approval: "never" as const,
    validateInputIssues: EditDesignContract.issues,
  },
  {
    name: DESIGN_VECTOR_TOOL_NAME,
    modelDisclosure: {
      bootstrap: "deferred" as const,
      role: "material-write" as const,
    },
    description:
      "Edit one or more existing editable Vector Networks without asking the model to rewrite vertices, segments, path runs, regions, bounds, transforms, or result layer IDs. outline-stroke converts one inspected Vector's visible stroke into a new editable Vector sibling while preserving the source; split-vector separates one inspected multi-path Vector into host-created sibling layers in authored path order while preserving stable path geometry and per-path regions; compound regions spanning multiple paths fail without partial writes. flatten destructively replaces explicit supported same-parent Frame, Group, Boolean, Component Instance current projection, exact glyph-outline Text (including resolved run Styles and basic underline/strikethrough), Image, shape including decorated Line, Path, or Vector nodeIds with one editable Vector while preserving nested child order, rounded Frame clipping, and visible Fill/outlined Stroke order; the host resolves Boolean geometry, transforms, topology, and result IDs. shape-builder destructively extracts one clicked painted region, subtracts one clicked region, or merges the atomic regions crossed by a document-space drag across explicit same-parent Vector layers. erase subtracts one document-space round or square gesture from explicit Vector layer IDs after materializing visible Fill, Stroke, dash, and variable-width appearance; disconnected results remain contours in the original layer and fully erased targets are deleted. Image Flatten preserves Stretch/Fit/Fill/Crop, focal placement, zoom, rotation, flips, filters, and rounded clipping as a region-local Image Paint. For exactly one selected root, the host projects current Component, Shared Style, and Variable appearance and preserves that root opacity/effect/blend/mask shell on the result Vector; Paint Variables are materialized and detached. set-region-fills applies direct typed Paint and detaches a prior Style; set-region-fill-style links one inspected closed region to one inspected PAINT Style. set-vertex-stroke-appearance changes inspected point cap/join overrides; set-vertex-corner-radius applies a non-negative circular radius to inspected straight closed-contour vertices, while null restores the node fallback. bend-segment moves one inspected path parameter to an explicit node-local point and lets the host derive stable cubic handles. transform-vertices applies one inspected node-local affine matrix inside one layer; transform-layers-vertices applies one document-space matrix to explicit per-layer vertex groups, including branch junctions, and atomically commits every changed layer. Both preserve attached Bézier tangents and their authored relationships. connect-endpoints joins two inspected unique endpoints, including inside an existing branch network, or extends one endpoint to another path vertex to create a shared branch junction. Cross-layer Connect keeps the earlier matching sibling layer, transforms and remaps the appended geometry, and deletes the appended layer in the same revision. disconnect-vertex creates a true break at one inspected internal vertex or detaches one explicit incident edge/open-path endpoint from a shared junction; an internal or closed-path junction requires segmentId. delete-segments removes only explicit inspected segment IDs and deterministically retains or splits their owning paths. delete-vertices removes explicit inspected points and reconnects each surviving owning path, including shared branch junctions. set-closed opens or closes one explicit contour; reverse-path reverses one contour while preserving effective closed-region winding; cut-path creates a true break at an inspected vertex, including a shared junction on an explicit path, or at parameter t on an inspected line/cubic segment, including an explicit branch segment; cut-with-line divides supported open or closed contours using node-local coordinates; cut-layers-with-line applies one document-space line across explicit Vector layer IDs and atomically divides every crossed target into host-created editable sibling layers. Closed boundaries may cross the line two or more transverse times: the host stitches boundary arcs with same-side cut connectors, keeps the component containing the source start under the stable source path/region ID, and collects the other closed components into one sibling network. If a line crosses both the unambiguous outer loop and one or more hole loops, crossed-hole boundaries become continuous closed result loops rather than retaining invalid holes. Uncut holes move unchanged with the sibling component that contains them, preserving stable path IDs and effective nonzero winding. Open contours split at every transverse crossing into alternating retained/extracted path runs without connectors, regions, or implicit fill. Connected/branch networks are partitioned by shared-vertex and region connectivity, so every uncut arm follows its actual junction component. Targets are stable Page, node, path, region, vertex, and segment IDs returned by inspection, never the send-time or live selection. The host resolves each layer's world transform, computes geometry through the same versioned vector-edit service as the human canvas, previews the complete change, and applies one atomic undoable EditorRuntime transaction. Unchanged targets are omitted; missing, locked, stale, out-of-scope, non-invertible, invalid, mismatched cross-layer appearance, exact shared-junction line hits, mixed-side connected Cut components, other unsupported topology mutations, tangent, overlapping, direct hole-only cuts, ambiguous outer loops, and shared compound loops are rejected. Branch-junction point Delete, unique endpoint merge, explicit-path Open/Close/Reverse, closed-path incident-edge Disconnect, independent handle movement, explicit segment Bend/Cut/Delete, and explicit open-path endpoint Disconnect are supported; closed/internal junction Disconnect without an incident segment, Text without exact outlines, and multi-root or descendant pixel-composited Flatten remain separate capabilities and must not be simulated with this tool.",
    inputSchema: DESIGN_VECTOR_TOOL_INPUT_SCHEMA,
    risk: "design_write" as const,
    approval: "never" as const,
    validateInputIssues: DesignVectorContract.issues,
  },
  {
    name: DESIGN_SYSTEM_TOOL_NAME,
    modelDisclosure: {
      bootstrap: "deferred" as const,
      continuation: "available" as const,
      role: "material-write" as const,

      continuationDescription:
        "Create a justified reusable Component Main or linked Component Instance for the current design. Use this only when the design intent identifies a repeated semantic object; otherwise keep the object as an ordinary named Frame/Group.",
      continuationInputSchema: DESIGN_SYSTEM_CONTINUATION_INPUT_SCHEMA,
    },
    description:
      "Manage the current Design File's reusable design system through one typed boundary. Choose kind=component for Component Mains, Instances, Variants, properties, Slots, overrides, detach, and Go to main; kind=variable for collections, modes, values, aliases, scopes, code syntax, bindings, and mode overrides; or kind=style for local Paint, Text, Effect, and Grid Style creation, metadata, ordering, references, detach, and deletion. Each kind preserves its dedicated versioned service, stable inspected IDs, Page scope, preview, atomic revision, and one undo step. Imported Library snapshots remain read-only. Do not write Component definitions, Style registries, Variable registries, or their references through generic node edits.",
    inputSchema: DESIGN_SYSTEM_TOOL_INPUT_SCHEMA,
    risk: "design_write" as const,
    approval: "never" as const,
    validateInputIssues: DesignSystemContract.issues,
  },
  {
    name: PAGE_STRUCTURE_ACCESS_TOOL_NAME,
    modelDisclosure: {
      bootstrap: "available" as const,
      continuation: "available" as const,
    },
    description:
      "Request one user-approved, Run-scoped capability to modify Page structure or design across Pages in the currently bound Design File. Call this only when the user's request actually requires creating, duplicating, reordering, deleting, or editing another Page. The default Run remains bound to the current Page until the user approves. Approval expires when this Run ends and never grants access to another Design File, Project, directory, or future Run. After approval, inspect the Design File again before calling opendesign_manage_pages or planning work on another Page. Do not call this for renaming the already bound Page or for ordinary edits inside the current Page.",
    inputSchema: PAGE_STRUCTURE_ACCESS_TOOL_INPUT_SCHEMA,
    risk: "design_write" as const,
    approval: "required" as const,
    approvalScope: "run" as const,
    approvalPrompt: {
      title: "Allow Page structure changes",
      summary:
        "This task is requesting temporary access to create, duplicate, reorder, delete, or edit across Pages in the bound Design File. Access expires when the task ends.",
    },
    validateInputIssues: PageStructureAccessContract.issues,
  },
  {
    name: DESIGN_PAGE_TOOL_NAME,
    modelDisclosure: {
      bootstrap: "available" as const,
      continuation: "available" as const,
      role: "material-write" as const,
    },
    description:
      "Create, rename, duplicate, reorder, clear, or delete Pages in the currently bound OpenDesign Design File through one validated, undoable transaction. Use clear when the user asks to remove all design content from a Page while keeping that Page; do not manually delete roots, detach Components, amend an old delivery Plan, or capture the resulting empty canvas. The host atomically preserves surviving cross-Page Component instances, clears every root, and supersedes unfinished delivery for the cleared Page. Use exactly the fields declared for the selected action: create has name and optional index but no pageId; rename has pageId and name but no index. Names may be duplicated and are trimmed to 1–256 non-control characters. create makes an empty Page; duplicate clones the complete Page node tree with host-generated stable IDs while sharing document-level assets; reorder uses a zero-based final index; delete removes that Page tree but never the final Page. rename and clear are allowed for the Run-bound Page without expanding scope. create, duplicate, reorder, delete, and operations targeting another Page require a successful opendesign_request_page_structure_access approval in this Run. Page IDs and node IDs for new copies are generated by the host and returned in the result; never invent them. Page lifecycle and clear changes do not require a visual design plan or canvas review.",
    inputSchema: DESIGN_PAGE_TOOL_INPUT_SCHEMA,
    risk: "design_write" as const,
    approval: "never" as const,
    validateInputIssues: DesignPageContract.issues,
  },
  {
    name: DESIGN_TEXT_RANGE_TOOL_NAME,
    modelDisclosure: {
      bootstrap: "deferred" as const,
      role: "material-write" as const,
    },
    description:
      "Style one inspected, non-empty UTF-16 [start,end) range on a stable Text node in the active Page. Character fields apply exactly; paragraph indent/spacing and list fields expand to all touched paragraphs. Markers derive from paragraph facts and never enter content. Active list levels are 1–5; enabling one defaults level 0 to 1. Change node-level hangingList with inspected update_properties. The host rejects stale revisions, invalid targets/ranges, surrogate splits, wrong Style types, and no-ops. Exact Text/Paint Style IDs use the local registry; direct typography or Fill edits detach that range reference. This writes one update_text_range_style transaction through the same Runtime, layout, revision, undo, save, projection, capture, and export path. Inspect current content, runs, and paragraphRuns first; never guess offsets.",
    inputSchema: DESIGN_TEXT_RANGE_TOOL_INPUT_SCHEMA,
    risk: "design_write" as const,
    approval: "never" as const,
    validateInputIssues: DesignTextRangeContract.issues,
  },
  {
    name: DESIGN_FONT_TOOL_NAME,
    modelDisclosure: {
      bootstrap: "deferred" as const,
      role: "material-write" as const,
    },
    description:
      "Inspect the current design first, then explicitly reflow or replace one exact font face request on stable Text node IDs inside the active Page. A face identity contains fontFamily, exact fontStyleName (null only for an unresolved legacy/external source), numeric fontWeight, and normal/italic fontSlant; never infer a style name from weight. expectedFont must exactly match every target at execution time. reflow keeps the requested face and remeasures Auto Width/Auto Height text; replace atomically changes every target to replacementFont. The host rejects stale, locked, non-Text, cross-Page, or known-missing replacement faces, preserves Fixed text-box size, and runs Auto Size plus Auto Layout through the trusted Text Service. Use the inspection fontAvailability summary; do not guess installed fonts or font paths.",
    inputSchema: DESIGN_FONT_TOOL_INPUT_SCHEMA,
    risk: "design_write" as const,
    approval: "never" as const,
    validateInputIssues: DesignFontContract.issues,
  },
] as const;

export const DESIGN_CAPABILITY_QUERY_SCHEMA = Type.Object(
  {
    tools: Type.Optional(
      Type.Array(
        Type.Union(TOOL_DESCRIPTORS.map((tool) => Type.Literal(tool.name))),
        { uniqueItems: true },
      ),
    ),
  },
  { additionalProperties: false },
);
export type DesignCapabilityQueryInput = Static<
  typeof DESIGN_CAPABILITY_QUERY_SCHEMA
>;
export const DesignCapabilityQueryContract =
  defineContract<DesignCapabilityQueryInput>({
    schema: DESIGN_CAPABILITY_QUERY_SCHEMA,
    code: "design_capabilities.input_invalid",
    subject: "Design capability query",
    recovery:
      "Choose registered tool names from the tools enum. Omit tools to keep the current selection, or use [] for basic tools.",
    clone: false,
  });

export const DESIGN_AGENT_TOOL_SPECS = TOOL_DESCRIPTORS.map((tool) =>
  tool.name === DESIGN_CAPABILITIES_TOOL_NAME
    ? {
        ...tool,
        inputSchema: DESIGN_CAPABILITY_QUERY_SCHEMA,
        validateInputIssues: DesignCapabilityQueryContract.issues,
      }
    : tool,
);

type ToolInputIssues = (input: unknown) => readonly AgentToolFailureIssue[];

const TOOL_INPUT_ISSUES = new Map<string, ToolInputIssues>([
  ...DESIGN_AGENT_TOOL_SPECS.map(
    (spec) => [spec.name, spec.validateInputIssues] as const,
  ),
  [INTERNAL_IMPORT_SVG_TOOL_NAME, InternalImportSvgContract.issues],
  [INTERNAL_UPDATE_IMAGE_TOOL_NAME, InternalUpdateImageContract.issues],
  [
    INTERNAL_READ_IMAGE_SOURCE_TOOL_NAME,
    InternalReadImageSourceContract.issues,
  ],
  [INTERNAL_DESIGN_COMPONENT_TOOL_NAME, DesignComponentContract.issues],
  [INTERNAL_DESIGN_VARIABLE_TOOL_NAME, DesignVariableContract.issues],
  [INTERNAL_DESIGN_STYLE_TOOL_NAME, DesignStyleContract.issues],
  [
    INTERNAL_DESIGN_APPLY_TOOL_NAME,
    (input: unknown) => DesignApplyContract.issues(input, { internal: true }),
  ],
]);

export function designAgentToolInputIssues(
  toolName: string,
  input: unknown,
): readonly AgentToolFailureIssue[] {
  const issues = TOOL_INPUT_ISSUES.get(toolName);
  return issues
    ? issues(input)
    : [
        {
          code: "design_tool.unknown",
          path: "/",
          message: `Unknown design tool: ${toolName}`,
          recovery: "Use a tool from the current trusted catalog.",
        },
      ];
}

/** Main-to-Renderer validation accepts canonical host-only fields. */
export function rendererDesignToolInputIssues(
  toolName: string,
  input: unknown,
): readonly AgentToolFailureIssue[] {
  if (toolName === DESIGN_EDIT_TOOL_NAME) {
    return EditDesignContract.issues(input, {
      canonical: true,
      internal: true,
    });
  }
  return designAgentToolInputIssues(toolName, input);
}

export function validateDesignAgentToolInput(
  toolName: string,
  input: unknown,
): boolean {
  return designAgentToolInputIssues(toolName, input).length === 0;
}
