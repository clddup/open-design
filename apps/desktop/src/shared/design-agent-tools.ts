import { DESIGN_BOOTSTRAP_APPLY_INPUT_SCHEMA } from "./design-bootstrap-apply-schema";
import {
  DeliveryScopeContract,
  DESIGN_DELIVERY_SCOPE_TOOL_INPUT_SCHEMA,
  deliveryScopeApprovalPrompt,
} from "./design-delivery-scope";
import {
  DESIGN_FIRST_SLICE_TOOL_INPUT_SCHEMA,
  FirstSliceContract,
} from "./design-first-slice-tool";
import { DesignApplyContract } from "./design-apply-input";
import {
  DESIGN_ARRANGE_TOOL_INPUT_SCHEMA,
  isDesignArrangeToolInput,
} from "./design-arrange-tool";
import {
  DesignPlanContract,
  DESIGN_PLAN_TOOL_INPUT_SCHEMA,
  DESIGN_VISUAL_REVIEW_TOOL_INPUT_SCHEMA,
  normalizeDesignVisualReviewToolInput,
} from "./design-agent-plan-review";
import { isRecord } from "./design-agent-validation";
import {
  DESIGN_APPLY_TOOL_NAME,
  DESIGN_ARRANGE_TOOL_NAME,
  DESIGN_CAPABILITIES_TOOL_NAME,
  DESIGN_CAPTURE_TOOL_NAME,
  DESIGN_CHECKPOINT_TOOL_NAME,
  DESIGN_COMPONENT_TOOL_NAME,
  DESIGN_DELIVERY_SCOPE_TOOL_NAME,
  DESIGN_FIRST_SLICE_TOOL_NAME,
  DESIGN_FONT_TOOL_NAME,
  DESIGN_HIERARCHY_TOOL_NAME,
  DESIGN_INSPECT_TOOL_NAME,
  DESIGN_PAGE_TOOL_NAME,
  DESIGN_PLAN_TOOL_NAME,
  DESIGN_REVIEW_TOOL_NAME,
  DESIGN_STYLE_TOOL_NAME,
  DESIGN_TEXT_RANGE_TOOL_NAME,
  DESIGN_VARIABLE_TOOL_NAME,
  DESIGN_VECTOR_TOOL_NAME,
  EXPORT_RASTER_TOOL_NAME,
  EXPORT_SVG_TOOL_NAME,
  EDIT_IMAGE_TOOL_NAME,
  GENERATE_IMAGE_TOOL_NAME,
  IMPORT_SVG_TOOL_NAME,
  INTERNAL_DESIGN_APPLY_TOOL_NAME,
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
  isInternalReadImageSourceToolInput,
  isInternalUpdateImageToolInput,
} from "./design-agent-image-tools";
import {
  EXPORT_RASTER_TOOL_INPUT_SCHEMA,
  EXPORT_SVG_TOOL_INPUT_SCHEMA,
  IMPORT_SVG_TOOL_INPUT_SCHEMA,
  isExportRasterToolInput,
  isExportSvgToolInput,
  isImportSvgToolInput,
  isInternalImportSvgToolInput,
} from "./design-agent-import-export-tools";
import {
  DESIGN_HIERARCHY_TOOL_INPUT_SCHEMA,
  DESIGN_VECTOR_TOOL_INPUT_SCHEMA,
  isDesignHierarchyToolInput,
  isDesignVectorToolInput,
} from "./design-agent-structure-tools";
import {
  DESIGN_APPLY_TOOL_INPUT_SCHEMA,
  DESIGN_FONT_TOOL_INPUT_SCHEMA,
  DESIGN_TEXT_RANGE_TOOL_INPUT_SCHEMA,
} from "./design-agent-operation-schemas";
import { DESIGN_COMPONENT_TOOL_INPUT_SCHEMA } from "./design-component-tool-schema";
import {
  DESIGN_PAGE_TOOL_INPUT_SCHEMA,
  PAGE_STRUCTURE_ACCESS_TOOL_INPUT_SCHEMA,
  isDesignFontToolInput,
  isDesignTextRangeToolInput,
  isPageStructureAccessToolInput,
  normalizeDesignPageToolInput,
} from "./design-agent-document-tools";
import {
  DesignCheckpointContract,
  DESIGN_CHECKPOINT_TOOL_INPUT_SCHEMA,
} from "./design-agent-checkpoint";
import {
  explainInvalidDesignComponentToolInput,
  isDesignComponentToolInput,
} from "./design-component-tool";
import { isDesignVariableToolInput } from "./design-variable-tool";
import { DESIGN_VARIABLE_TOOL_INPUT_SCHEMA } from "./design-variable-tool-schema";
import { isDesignStyleToolInput } from "./design-style-tool";
import { DESIGN_STYLE_TOOL_INPUT_SCHEMA } from "./design-style-tool-schema";
export {
  DesignApplyContract,
  designApplyRequiresPlan,
} from "./design-apply-input";
export { DESIGN_BOOTSTRAP_APPLY_INPUT_SCHEMA } from "./design-bootstrap-apply-schema";
export type { DesignBriefFidelity } from "./design-brief-fidelity";
export {
  DeliveryScopeContract,
  DESIGN_DELIVERY_SCOPE_TOOL_INPUT_SCHEMA,
} from "./design-delivery-scope";
export type { DesignDeliveryScope } from "./design-delivery-scope";
export {
  DESIGN_TARGET_QUALITY_PROFILE_SCHEMA,
  isDesignTargetQualityProfile,
  minimumInteractiveTargetSize,
  qualityProfileNodeIds,
} from "./design-plan-quality-profile";
export type {
  DesignQualityInteractionMode,
  DesignQualityPlatform,
  DesignSafeAreaInsets,
  DesignTargetQualityProfile,
} from "./design-plan-quality-profile";
export {
  compileDesignFirstSliceToolInput,
  DESIGN_FIRST_SLICE_TOOL_INPUT_SCHEMA,
  FirstSliceContract,
  logoBriefRequiresExploration,
} from "./design-first-slice-tool";
export type {
  DesignFirstSliceElement,
  DesignFirstSliceToolInput,
  FirstSliceContractContext,
} from "./design-first-slice-tool";
export type {
  DesignApplyToolInput,
  DesignApplyContractContext,
  InternalDesignApplyToolInput,
  PlannedDesignRebaseGuard,
  PlannedDesignRebaseTarget,
} from "./design-apply-input";
export {
  DESIGN_ARRANGE_TOOL_INPUT_SCHEMA,
  isDesignArrangeToolInput,
} from "./design-arrange-tool";
export type { DesignArrangeToolInput } from "./design-arrange-tool";
export { componentStrategyOccurrencesForTarget } from "./design-plan-component-strategy";
export {
  DESIGN_PLAN_CANONICAL_INPUT_SCHEMA,
  DESIGN_LOGO_EXPLORATION_SCHEMA,
  DESIGN_PLAN_TOOL_INPUT_SCHEMA,
  DESIGN_VISUAL_CRITERIA,
  DESIGN_VISUAL_REVIEW_TOOL_INPUT_SCHEMA,
  DesignPlanContract,
  designPlanBriefFidelity,
  designPlanComponentStrategy,
  designPlanDesignIntent,
  designPlanLogoExploration,
  designPlanReferenceStrategy,
  designPlanSkillRefs,
  designPlanTargets,
  isDesignVisualReviewToolInput,
  normalizeDesignVisualReviewToolInput,
} from "./design-agent-plan-review";
export type {
  DesignDeliverable,
  DesignIntent,
  DesignLogoExploration,
  DesignPlanContractContext,
  DesignPlanArtboard,
  DesignPlanComposition,
  DesignPlanRegion,
  DesignPlanRegionRole,
  DesignPlanTarget,
  DesignPlanToolInput,
  DesignPlanVisualSystem,
  DesignVisualCriterion,
  DesignVisualReviewToolInput,
  PlaceableRasterAssetRole,
  RasterAssetRole,
} from "./design-agent-plan-review";
export {
  DESIGN_REFERENCE_DECISIONS,
  DESIGN_REFERENCE_STRATEGY_SCHEMA,
  MAX_ACTIVE_VISUAL_REFERENCES,
  activeVisualReferenceIds,
  isActiveVisualReferenceDecision,
} from "./design-reference-strategy";
export type {
  DesignReferenceDecision,
  DesignReferenceStrategy,
} from "./design-reference-strategy";
export {
  explainInvalidDesignComponentToolInput,
  isDesignComponentToolInput,
} from "./design-component-tool";
export type { DesignComponentToolInput } from "./design-component-tool";
export { isDesignVariableToolInput } from "./design-variable-tool";
export { DESIGN_VARIABLE_TOOL_INPUT_SCHEMA } from "./design-variable-tool-schema";
export type { DesignVariableToolInput } from "./design-variable-tool";
export { isDesignStyleToolInput } from "./design-style-tool";
export { DESIGN_STYLE_TOOL_INPUT_SCHEMA } from "./design-style-tool-schema";
export type { DesignStyleToolInput } from "./design-style-tool";
export type {
  DesignPlanComponentCandidate,
  DesignPlanComponentStrategy,
  DesignPlanSemanticOccurrence,
} from "./design-plan-component-strategy";
export {
  DESIGN_IMAGE_PLACEMENT_SCHEMA,
  EditImageContract,
  EDIT_IMAGE_TOOL_INPUT_SCHEMA,
  GenerateImageContract,
  GENERATE_IMAGE_TOOL_INPUT_SCHEMA,
  PlaceImageContract,
  PLACE_IMAGE_TOOL_INPUT_SCHEMA,
  ReadImageContract,
  READ_IMAGE_TOOL_INPUT_SCHEMA,
  UpdateImageContract,
  UPDATE_IMAGE_TOOL_INPUT_SCHEMA,
  isInternalReadImageSourceToolInput,
  isInternalUpdateImageToolInput,
  isPreparedImageEditSource,
} from "./design-agent-image-tools";
export type {
  EditImageToolInput,
  GenerateImageToolInput,
  ImageGenerationOutputFormat,
  ImageGenerationQuality,
  ImageGenerationSize,
  InternalUpdateImageToolInput,
  InternalReadImageSourceToolInput,
  PlaceImageToolInput,
  ReadImageToolInput,
  PreparedImageEditSource,
  UpdateImageToolInput,
} from "./design-agent-image-tools";
export {
  EXPORT_RASTER_TOOL_INPUT_SCHEMA,
  EXPORT_SVG_TOOL_INPUT_SCHEMA,
  IMPORT_SVG_TOOL_INPUT_SCHEMA,
  isAgentSvgImportResult,
  isExportRasterToolInput,
  isExportSvgToolInput,
  isImportSvgToolInput,
  isInternalImportSvgToolInput,
  isPreparedAgentRasterExport,
  isPreparedAgentSvgExport,
} from "./design-agent-import-export-tools";
export type {
  AgentSvgImportResult,
  ExportRasterToolInput,
  ExportSvgToolInput,
  ImportSvgToolInput,
  InternalImportSvgToolInput,
  PreparedAgentRasterExport,
  PreparedAgentSvgExport,
} from "./design-agent-import-export-tools";
export {
  DESIGN_HIERARCHY_TOOL_INPUT_SCHEMA,
  DESIGN_VECTOR_TOOL_INPUT_SCHEMA,
  isDesignHierarchyToolInput,
  isDesignVectorToolInput,
} from "./design-agent-structure-tools";
export type {
  DesignHierarchyToolInput,
  DesignVectorToolInput,
} from "./design-agent-structure-tools";
export {
  DESIGN_APPLY_TOOL_INPUT_SCHEMA,
  DESIGN_FONT_TOOL_INPUT_SCHEMA,
  DESIGN_TEXT_RANGE_TOOL_INPUT_SCHEMA,
} from "./design-agent-operation-schemas";
export { DESIGN_COMPONENT_TOOL_INPUT_SCHEMA } from "./design-component-tool-schema";
export {
  DESIGN_PAGE_TOOL_INPUT_SCHEMA,
  PAGE_STRUCTURE_ACCESS_TOOL_INPUT_SCHEMA,
  isDesignFontToolInput,
  isDesignPageToolInput,
  isDesignTextRangeToolInput,
  isPageStructureAccessToolInput,
  normalizeDesignPageToolInput,
} from "./design-agent-document-tools";
export type {
  DesignFontToolInput,
  DesignPageToolInput,
  DesignTextRangeToolInput,
  PageStructureAccessAction,
  PageStructureAccessToolInput,
} from "./design-agent-document-tools";
export {
  DesignCheckpointContract,
  DESIGN_CHECKPOINT_TOOL_INPUT_SCHEMA,
} from "./design-agent-checkpoint";
export type { DesignCheckpointToolInput } from "./design-agent-checkpoint";
export * from "./design-agent-tool-names";
export const DESIGN_AGENT_TOOL_SPECS = [
  {
    name: DESIGN_DELIVERY_SCOPE_TOOL_NAME,
    modelDisclosure: {
      bootstrap: "available" as const,
      beforePlan: "available" as const,
      role: "plan" as const,
      surfaces: ["general" as const, "new-design" as const],
      whenDeliveryScopeReview: "required" as const,
    },
    description:
      "For a broad product brief, document attachment, four-or-more deliverables, or a host-required scope review, propose the complete user-visible delivery plan before Page creation, design planning, or canvas writes. Each target must be one independently verifiable screen, flow, visual direction, or asset; do not collapse requested product areas into representative pages and do not split headings, cards, or decorative regions into targets. Include concise required content, exclusions, assumptions, and whether targets need separate Pages. The user sees the actual target list and must confirm it. A denial ends this Run without changing the canvas; submit a revised plan only after a new user message. Small focused requests execute directly and should not call this tool.",
    inputSchema: DESIGN_DELIVERY_SCOPE_TOOL_INPUT_SCHEMA,
    risk: "read" as const,
    approval: "required" as const,
    approvalScope: "call" as const,
    approvalDenial: "cancel-run" as const,
    approvalPrompt: deliveryScopeApprovalPrompt,
    validateInputIssues: (input: unknown) =>
      DeliveryScopeContract.issues(input),
  },
  {
    name: DESIGN_FIRST_SLICE_TOOL_NAME,
    modelDisclosure: {
      bootstrap: "available" as const,
      beforePlan: "available" as const,
      role: "material-write" as const,
      surfaces: ["new-design" as const],
    },
    description:
      "Create all requested artboard roots and one or more meaningful targets[0] regions in one rollback-safe call. In this same call, provide one concise brief-specific designIntent, target job/layout/spacing, visualSystem, required rasterAssetRoles, and justified reusable semanticObjects; never explain every primitive or emit a separate design essay. Main binds only trusted skills, complete brief fidelity, and quality defaults. The first slice must visibly prove the thesis and causal signature motif, not draw generic circles/cards/gradients and rationalize them afterward. Declare every requested target and its complete required region set; materialize the complete first target when it fits the 48 model-content-element budget, otherwise submit the smallest coherent real portion and continue it directly after this commit. Main creates host-owned region Frames, so firstSlice elements must parent content to region IDs and never repeat those IDs. For a requested multi-direction Logo exploration, declare logoExploration and all three concept regions before drawing so partial evidence cannot be verified. Use 1-3 semantic stages and at most 48 model-authored content elements total, not per stage. Use inspected Pages, prefixed IDs, parent-local geometry, and exact font faces. Full material tools follow success.",
    inputSchema: DESIGN_FIRST_SLICE_TOOL_INPUT_SCHEMA,
    risk: "design_write" as const,
    approval: "never" as const,
    validateInputIssues: FirstSliceContract.issues,
  },
  {
    name: DESIGN_CAPABILITIES_TOOL_NAME,
    modelDisclosure: {
      bootstrap: "deferred" as const,
      afterInspection: "available" as const,
    },
    description:
      "Read the trusted, versioned OpenDesign professional design capability manifest. It reports available, degraded, and unavailable workflows across contract, runtime, human UI, Agent, render, and export surfaces, including providers, limitations, and evidence counts. Call this before planning work that may require Pen editing, boolean operations, Auto Layout, components, variables, rich typography, image crop, AI image editing, or export.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    risk: "read" as const,
    approval: "never" as const,
  },
  {
    name: DESIGN_INSPECT_TOOL_NAME,
    modelDisclosure: {
      bootstrap: "available" as const,
      role: "inspection" as const,
      surfaces: ["general" as const, "new-design" as const],
    },
    description:
      "Read the currently bound OpenDesign Design File, active Page, node tree, referenced asset metadata, selection, revision, a Run-scoped idAllocation.newNodeIdPrefix, and bounded structural/render diagnostics before planning a design change. Every newly authored document entity ID must start with that exact prefix because Node IDs are Design File-global even when Page-scoped inspection hides other Pages; existing IDs remain unchanged. Diagnostics identify empty paths/text, invisible nodes, missing assets, non-finite or clipped-out bounds, root-layer fragmentation, and actual Path/gradient/glow/blur/blend/mask/image/text usage. Asset source bytes and URIs are intentionally omitted; use opendesign_capture_canvas for bounded visual inspection. This does not inspect project files, source code, directories, or other Design Files. Call this instead of guessing canvas structure.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    risk: "read" as const,
    approval: "never" as const,
  },
  {
    name: DESIGN_CAPTURE_TOOL_NAME,
    modelDisclosure: { bootstrap: "deferred" as const },
    description:
      "Capture the Main-selected target in the Run-bound OpenDesign document as a bounded image and return it as multimodal content together with captureTarget, the observed document revision, and reviewWorkflow. After the planned artboard exists, captureTarget is that exact Frame; otherwise it is the bound Page. Frame captures return layoutQuality, a trusted exact-revision report over the complete rendered Component projection, clipping ancestor chain, artboard containment, quality profile, and production text layout. A componentTarget is the stable instanceId + sourcePath repair identity; projection node IDs are capture-only and must never be reused as persistent mutation targets. Overflow issues include world-space bounds plus parent-local repair geometry. When reviewWorkflow.nextAction is repair-layout-overflow, call the returned opendesign_arrange repair-overflow action first; it expands safe trailing-edge delivery and persistent clipping Frames in one undoable revision, then capture again. If that bounded repair fails, inspect and explicitly correct the unsafe structure. A clean production capture automatically runs the stateless exact-revision critic and returns its host-derived scores, failedCriteria, and refinements in reviewWorkflow; follow nextAction. Call record_visual_review only when reviewEligible is explicitly true as a legacy recovery path. Final verification may include a bounded non-blocking componentStrategy report when actual Component/Instance bindings differ from the model-authored plan; it is maintainability guidance and does not invalidate an otherwise useful visual delivery. The capture uses an isolated Leafer projection of the captured revision, so user pan, zoom, selection, window size, or switching to another open Design File cannot change its pixels or mutation target. Use this after a successful material design write to evaluate the rendered composition, hierarchy, spacing, proportions, and effects before recording the required visual review. A baseline capture before a write may inform planning but does not unlock review. This does not capture other applications, windows, files, or screens.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    risk: "read" as const,
    approval: "never" as const,
  },
  {
    name: DESIGN_PLAN_TOOL_NAME,
    modelDisclosure: {
      bootstrap: "available" as const,
      role: "plan" as const,
    },
    description:
      "Define the executable delivery plan after inspection and before imagery or design writes. Match requested deliverables exactly and omit host-bound skillRefs. Declare intent, brief fidelity, evidence medium, image classifications, component decisions, stable artboards/regions, and quality profiles. Use imagery when real-world subject evidence matters; vectors may serve logos, diagrams, and intentional illustration. UI quality nodes must be real foreground/control descendants, never the delivery Frame; non-UI uses graphic. Main allocates create targets as Page-root Frames and verifies live geometry, components, capture, review, refinement, and delivery. single-raster requires one explicitly requested flattened target and no component candidates.",
    inputSchema: DESIGN_PLAN_TOOL_INPUT_SCHEMA,
    risk: "design_write" as const,
    approval: "never" as const,
    validateInputIssues: DesignPlanContract.issues,
  },
  {
    name: DESIGN_REVIEW_TOOL_NAME,
    modelDisclosure: { bootstrap: "deferred" as const },
    description:
      "Legacy recovery only: record a typed Visual Review when the newest opendesign_capture_canvas result explicitly returns reviewEligible=true. Main binds the exact locally loaded critic revision for the active deliverable; do not send skillRefs. Compare the capture with the latest request, briefFidelity and active designIntent; evaluate every non-compensating critic criterion, explicitly list failedCriteria, and name at least two concrete refinements. For non-UI work whose credibility depends on a real subject or environment, missing required raster evidence fails subject-specificity and material-coherence; typography cannot compensate for it. Strong color or accessibility cannot compensate for a missing visual thesis, invisible signature motif, generic composition, weak typography, incoherent material system, or template symptoms. Any fidelity or criterion failure must appear in refinements. Do not submit generic praise. The host rejects malformed reviews, baseline/pre-write captures, already-reviewed captures, and captures older than the latest material revision. This records Run review state and does not mutate the canvas.",
    inputSchema: DESIGN_VISUAL_REVIEW_TOOL_INPUT_SCHEMA,
    risk: "read" as const,
    approval: "never" as const,
  },
  {
    name: DESIGN_CHECKPOINT_TOOL_NAME,
    modelDisclosure: { bootstrap: "deferred" as const },
    description:
      "Execute a real design checkpoint without a Provider round trip used only to request capture. Use apply-and-capture when the next material transaction is fully known: Main validates and commits it through the canonical apply path, then captures only if that write produced a new trusted revision. Fast mode returns trusted deterministic verification without an independent critic. Thorough mode also returns independent critic findings; after reading them, use refine-and-capture when the concrete refinement is known. Main applies that refinement through the same canonical path and captures only the successful refined revision. A failed prerequisite short-circuits later stages. If capture fails after a committed write, the result preserves that designRevision and reports capture-failed so you can recover without repeating the write. This tool does not replace inspect, Plan, image generation, Page approval, or dependencies whose result must be read before authoring the next stage.",
    inputSchema: DESIGN_CHECKPOINT_TOOL_INPUT_SCHEMA,
    risk: "design_write" as const,
    approval: "never" as const,
    validateInputIssues: DesignCheckpointContract.issues,
  },
  {
    name: READ_IMAGE_TOOL_NAME,
    modelDisclosure: { bootstrap: "available" as const },
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
      beforePlan: "deferred" as const,
    },
    description:
      "Generate one original raster image with OpenDesign's globally configured image-generation model. A successful opendesign_define_design_plan call must already declare the exact role as reference, background, hero, supporting-content, or final-single-image. This selection is application-wide and independent of the current conversation model. The result is staged immediately as a persistent current-Design-File asset and also returned as a current-Run attachment. Call opendesign_place_image only for a declared placeable role. The tool never accepts a provider or model ID and fails explicitly when no global image-generation model is configured.",
    inputSchema: GENERATE_IMAGE_TOOL_INPUT_SCHEMA,
    risk: "external" as const,
    approval: "never" as const,
    validateInputIssues: GenerateImageContract.issues,
  },
  {
    name: PLACE_IMAGE_TOOL_NAME,
    modelDisclosure: {
      bootstrap: "deferred" as const,
      role: "material-write" as const,
    },
    description:
      "Place either a current-Run image attachment or a persistent assetId returned by current Design File inspection. Supply exactly one source. A successful design plan must declare the image role. Existing assetId placement requires explicit width and height. Editable posters must first create their planned artboard Frame with meaningful editable shape/text content, then place the image inside that existing Frame or one of its inspected/current descendants; parentId may never be null for this flow. Do not copy attachmentId into image assetId. Editable posters cannot use final-single-image. The host inserts one image node through the same atomic OpenDesign transaction and revision history as every other design edit.",
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
      "Import one SVG attachment explicitly authorized for the current Run as an editable OpenDesign vector tree of supported layers. The supported subset preserves Frame/Group hierarchy, basic vectors, gradients, rounded Frame clipping, ordered sibling masks, and bounded filter effects; unsupported semantics return explicit fidelity issues. attachmentId must be a run-scoped svg_<sha256> handle shown in the user's attachment metadata; SVG XML and local paths are never accepted. pageId, parentId, and index must be stable targets returned by opendesign_inspect_document. x and y place the imported SVG's top-left corner in the local coordinate system of that Page root, Frame, or Group. The tool never reads the live user selection or viewport. Main materializes the authorized SVG only after validation, Renderer parses it in the same cancellable SVG worker as manual import, and the host previews and applies one atomic undoable EditorRuntime transaction, selects the imported root, and reports explicit fidelity issues.",
    inputSchema: IMPORT_SVG_TOOL_INPUT_SCHEMA,
    risk: "design_write" as const,
    approval: "never" as const,
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
  },
  {
    name: DESIGN_HIERARCHY_TOOL_NAME,
    modelDisclosure: {
      bootstrap: "deferred" as const,
      role: "material-write" as const,
    },
    description:
      "Edit existing layer hierarchy, Figma-style non-destructive sibling masks, and non-destructive Boolean groups in the currently bound Design File without asking the model to calculate low-level moves, transforms, or derived paths. It can group or ungroup, create one contained mask object from explicit siblings with the bottom layer as Alpha/Vector/Luminance source, change or remove that mask, create/change/ungroup Boolean geometry, reorder siblings, or reparent layers to an explicit Page-root, Frame, or Group insertion index. Masked content and Boolean operands remain editable; derived rendering is never model-authored or persisted. Reparenting preserves world transforms and dynamically recomputes affected Group bounds; Frame sizes remain fixed. Targets are explicit stable node IDs on an explicit existing Page, never the send-time or live user selection. The host previews the complete change and applies it as one atomic undoable OpenDesign transaction. It rejects locked layers, mixed parents, stale revisions, out-of-scope nodes, duplicate IDs, ambiguous nested masks, unsupported mask sources or Boolean operands, cycles, empty source Groups, non-invertible targets, no-op changes, and visually lossy ungrouping; inherited clipping or appearance changes return a visual-review warning.",
    inputSchema: DESIGN_HIERARCHY_TOOL_INPUT_SCHEMA,
    risk: "design_write" as const,
    approval: "never" as const,
  },
  {
    name: DESIGN_ARRANGE_TOOL_NAME,
    modelDisclosure: {
      bootstrap: "deferred" as const,
      role: "material-write" as const,
    },
    description:
      "Precisely arrange explicit existing layers in the currently bound Design File using host-computed geometry. It aligns selection bounds, distributes or sets exact spacing, performs deterministic one- or two-dimensional Tidy up, assigns Constraints v1 to an ordinary Frame child, resizes a Frame while resolving constraints, configures Frame-owned Auto Layout, direct flow-child sizing, bounded min/max width and height, an absolute child that ignores Auto Layout flow, or non-exported Frame Layout Guides with action=set-layout-guides. Uniform, Columns, and Rows guides are visual editing aids only: they never change child geometry, participate in Auto Layout, or appear in capture/export. Columns/Rows accept count/gutter and either stretch + margin or fixed start/center/end + sectionSize with edge offset. Auto Layout supports per-axis Frame Fixed/Hug, child Fixed/Fill, fixed or Auto gap, min/max clamping, bounded Fill redistribution, padding minimums, hidden-child exclusion, nested convergence, and horizontal Fill + Auto Height text remeasurement. Set primaryAlignment=space-between for Auto gap; it never becomes negative and starts a single child at the leading padding. Horizontal Wrap resolves Auto gap independently per row while preserving the explicit counter gap; it requires Fixed Frame width and rejects visible Fill children. Child geometry is always host-derived. The host previews the complete change and applies one atomic undoable transaction. Targets are stable Page and layer IDs returned by inspection, never the send-time or live user selection. It rejects locked, missing, stale, out-of-scope, non-invertible, ambiguous, lossy, no-op, inverted limits, and over-limit operations. Snapping, Auto Layout Grid, vertical wrap, Wrap+Fill, auto track gap, baseline, Smart Selection canvas handles, and reflow handles remain separate capabilities.",
    inputSchema: DESIGN_ARRANGE_TOOL_INPUT_SCHEMA,
    risk: "design_write" as const,
    approval: "never" as const,
  },
  {
    name: DESIGN_VECTOR_TOOL_NAME,
    modelDisclosure: {
      bootstrap: "deferred" as const,
      role: "material-write" as const,
    },
    description:
      "Edit one or more existing non-branching editable Vector Networks without asking the model to rewrite vertices, segments, path runs, regions, bounds, transforms, or result layer IDs. transform-vertices applies one inspected node-local affine matrix inside one layer; transform-layers-vertices applies one document-space matrix to explicit per-layer vertex groups and atomically commits every changed layer. Both preserve attached Bézier tangents and their authored relationships. connect-endpoints joins exactly two inspected endpoints in one Vector without introducing a branch; disconnect-vertex creates a true break at one inspected internal vertex. set-closed opens or closes one explicit contour; reverse-path reverses one contour while preserving effective closed-region winding; cut-path creates a true break at an inspected vertex or at parameter t on an inspected line/cubic segment; cut-with-line divides supported open or closed contours using node-local coordinates; cut-layers-with-line applies one document-space line across explicit Vector layer IDs and atomically divides every crossed target into host-created editable sibling layers. Closed boundaries may cross the line two or more transverse times: the host stitches boundary arcs with same-side cut connectors, keeps the component containing the source start under the stable source path/region ID, and collects the other closed components into one sibling network. If a line crosses both the unambiguous outer loop and one or more hole loops, crossed-hole boundaries become continuous closed result loops rather than retaining invalid holes. Uncut holes move unchanged with the sibling component that contains them, preserving stable path IDs and effective nonzero winding. Open contours split at every transverse crossing into alternating retained/extracted path runs without connectors, regions, or implicit fill. Targets are stable Page, node, path, vertex, and segment IDs returned by inspection, never the send-time or live selection. The host resolves each layer's world transform, computes geometry through the same versioned vector-edit service as the human canvas, previews the complete change, and applies one atomic undoable EditorRuntime transaction. Unchanged targets are omitted; missing, locked, stale, out-of-scope, non-invertible, invalid, branching, tangent, overlapping, direct hole-only cuts, ambiguous outer loops, and shared compound loops are rejected. Cross-layer Connect, branches, flatten, and outline stroke remain separate capabilities and must not be simulated with this tool.",
    inputSchema: DESIGN_VECTOR_TOOL_INPUT_SCHEMA,
    risk: "design_write" as const,
    approval: "never" as const,
  },
  {
    name: DESIGN_COMPONENT_TOOL_NAME,
    modelDisclosure: {
      bootstrap: "deferred" as const,
      role: "material-write" as const,
    },
    description:
      "Manage reusable components through OpenDesign's typed component runtime. create-component promotes one existing Frame/Group as the Main and requires exactly action, label, pageId, rootNodeId, componentId, and name. combine-as-variants creates one real Component Set Frame from inspected sibling Mains. add-component-to-variant-set, duplicate-variant, remove-variant, and dissolve-variant-set manage Set membership. add/rename/reorder/remove-variant-property, rename/reorder-variant-value, and set-variant-properties edit the Figma-compatible two-dimensional Variant matrix using explicit inspected Set/member roots; the host preserves complete unique combinations, property/value order, top-left defaults, current Instance resolution, one revision, and one undo. create-instance places a linked instance. add/rename/remove-property author Boolean, Text, Instance-swap, or Slot properties on explicit Main sublayers. create-slot-override, clear-slot, reset-slot, and set-slot-settings manage bounded instance Slot contents and guidance without detaching the Instance; arbitrary content is inserted only under the real override Slot root returned by a fresh inspection. set/reset-property also selects VARIANT values exposed by inspection. set/reset-overrides remains the advanced sourcePath layer and wins after typed properties. Main edits synchronize property defaults, ordinary Instance structure remains read-only, every write is previewed and atomic, and cross-Page work requires the same one-time Page structure access as other writes.",
    inputSchema: DESIGN_COMPONENT_TOOL_INPUT_SCHEMA,
    risk: "design_write" as const,
    approval: "never" as const,
    explainInvalidInput: explainInvalidDesignComponentToolInput,
  },
  {
    name: DESIGN_VARIABLE_TOOL_NAME,
    modelDisclosure: {
      bootstrap: "deferred" as const,
      role: "material-write" as const,
    },
    description:
      "Manage Figma-compatible Variables through the versioned Variable Service. Collections, modes, values, aliases, scopes, code syntax, Page/node mode overrides, and supported node/Paint bindings are validated, previewed, and applied as one atomic undoable transaction. Use stable IDs and current definitions from opendesign_inspect_document. BOOLEAN binds visibility, FLOAT binds opacity in 0..1, STRING binds Text content, and COLOR RGB/RGBA binds SolidPaint color. Scope only ranks picker recommendations and never replaces type validation. TIMING/EASING remain authorable but are not bindable before Motion support.",
    inputSchema: DESIGN_VARIABLE_TOOL_INPUT_SCHEMA,
    risk: "design_write" as const,
    approval: "never" as const,
  },
  {
    name: DESIGN_STYLE_TOOL_NAME,
    modelDisclosure: {
      bootstrap: "deferred" as const,
      role: "material-write" as const,
    },
    description:
      "Manage Figma-compatible local Paint, Text, Effect, and Grid styles through the versioned Style Service. Create or update a Style from an explicit inspected node property, edit metadata/order, apply or detach stable style references, and delete while preserving every consumer's resolved appearance. Every write is validated, previewed, atomic, undoable, and scoped to the current Design File and Page node IDs returned by inspection. Remote Libraries and arbitrary Figma private data are not accepted.",
    inputSchema: DESIGN_STYLE_TOOL_INPUT_SCHEMA,
    risk: "design_write" as const,
    approval: "never" as const,
  },
  {
    name: PAGE_STRUCTURE_ACCESS_TOOL_NAME,
    modelDisclosure: { bootstrap: "available" as const },
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
  },
  {
    name: DESIGN_PAGE_TOOL_NAME,
    modelDisclosure: {
      bootstrap: "available" as const,
      role: "material-write" as const,
    },
    description:
      "Create, rename, duplicate, reorder, clear, or delete Pages in the currently bound OpenDesign Design File through one validated, undoable transaction. Use clear when the user asks to remove all design content from a Page while keeping that Page; do not manually delete roots, detach Components, amend an old delivery Plan, or capture the resulting empty canvas. The host atomically preserves surviving cross-Page Component instances, clears every root, and supersedes unfinished delivery for the cleared Page. Use exactly the fields declared for the selected action: create has name and optional index but no pageId; rename has pageId and name but no index. Names may be duplicated and are trimmed to 1–256 non-control characters. create makes an empty Page; duplicate clones the complete Page node tree with host-generated stable IDs while sharing document-level assets; reorder uses a zero-based final index; delete removes that Page tree but never the final Page. rename and clear are allowed for the Run-bound Page without expanding scope. create, duplicate, reorder, delete, and operations targeting another Page require a successful opendesign_request_page_structure_access approval in this Run. Page IDs and node IDs for new copies are generated by the host and returned in the result; never invent them. Page lifecycle and clear changes do not require a visual design plan or canvas review.",
    inputSchema: DESIGN_PAGE_TOOL_INPUT_SCHEMA,
    risk: "design_write" as const,
    approval: "never" as const,
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
  },
  {
    name: DESIGN_APPLY_TOOL_NAME,
    modelDisclosure: {
      bootstrap: "available" as const,
      beforePlan: "available" as const,
      role: "material-write" as const,
      bootstrapDescription:
        "Perform a basic inspected edit inside an existing planned artboard. For new artboard roots, use opendesign_generate_first_slice instead so allocation and visible content land in one call without duplicated Plan prose. Never place this call before an existing-artboard Plan or bundle it across Page approval, image reading, or another prerequisite whose result must be inspected first. This compact phase supports Frame, Group, Rectangle, Ellipse, and Text with solid paints plus insert, basic property update, move, and delete commands. Every Text insert must include the complete Typography Core fields shown by the schema, including paragraphIndent, paragraphSpacing, listSpacing, hangingList, textCase, textDecoration, textTruncation, and maxLines; disabled truncation uses maxLines null, while ending truncation on Auto Size needs a positive maxLines. Prefer one region such as navigation, hero, primary mark, or core content instead of waiting to emit an entire page. Ordered steps must represent real semantic units and cover every command exactly once. The trusted host still validates and applies these commands through the same OpenDesign transaction, revision, history, scope, and recovery boundary. After a successful material revision, the complete apply schema and advanced professional tools become available automatically.",
      bootstrapInputSchema: DESIGN_BOOTSTRAP_APPLY_INPUT_SCHEMA,
    },
    description:
      "Apply one validated OpenDesign node transaction to the currently bound Design File and an existing Page. Supports insert_element, update_properties, move_element, delete_element, and replace_subtree. Use opendesign_style_text_range for an inspected non-empty rich-text range and opendesign_manage_fonts for explicit file-font reflow or replacement, keeping the general node schema compact. When one or several declared targets have known meaningful visible stages, provide ordered steps whose commandIds cover every command exactly once and in command order; use semantic units such as navigation, hero, content, and footer, never arbitrary 1–3 command batches. One transaction may update multiple declared artboards, but a single move or reparent operation may not cross artboard boundaries. The host commits each valid step as a real revision inside one rollback-safe history group and reports the committed step revisions; without steps it applies the transaction once. update_properties must match the inspected target kind; Group properties are empty, and the host validates the merged discriminated node before writing. Text must declare textResize auto-width/auto-height/fixed plus paragraphIndent, paragraphSpacing, listSpacing, hangingList, textCase, textDecoration, textTruncation, and maxLines. List type and indentation are paragraph-range facts applied with opendesign_style_text_range, never fake marker characters. Auto Width uses textWrap none + textOverflow visible; Auto Height keeps width and uses word/character wrapping + visible overflow; Fixed supports all textWrap choices and visible/clip overflow. The trusted host measures Auto Size and derived ending ellipsis with the versioned Text providers while preserving complete authored content and concrete authoritative size. A size update without an explicit non-fixed textResize switches that text layer to Fixed. For editable organic silhouettes, mascots, logos, custom icons, wings, limbs, fabric, and other non-geometric contours, use path or vector nodes with properties.network. Use properties.path only when exact imported SVG path data must be preserved and node-level point editing is not required; never provide path and network together. Coordinates are parent-local and must fit the node's declared size. Plan-created artboard Frames are already allocated; add real content inside declared Frames and do not recreate them. Composite designs should create a named Frame or Group together with its children; do not flatten parts into Page-root layers. This tool does not manage Projects, Design Files, or Pages. Use stable unique IDs. Recoverable invariant failures return structured commandId/nodeId/path issues; inspect and revise instead of repeating the same transaction.",
    inputSchema: DESIGN_APPLY_TOOL_INPUT_SCHEMA,
    risk: "design_write" as const,
    approval: "never" as const,
    validateInputIssues: DesignApplyContract.issues,
  },
] as const;

export function validateDesignAgentToolInput(
  toolName: string,
  input: unknown,
): boolean {
  if (toolName === DESIGN_FIRST_SLICE_TOOL_NAME) {
    return FirstSliceContract.parse(input).ok;
  }
  if (toolName === DESIGN_DELIVERY_SCOPE_TOOL_NAME) {
    return DeliveryScopeContract.parse(input).ok;
  }
  if (toolName === DESIGN_CAPABILITIES_TOOL_NAME) {
    return isRecord(input) && Object.keys(input).length === 0;
  }
  if (toolName === DESIGN_INSPECT_TOOL_NAME) {
    return isRecord(input) && Object.keys(input).length === 0;
  }
  if (toolName === DESIGN_CAPTURE_TOOL_NAME) {
    return isRecord(input) && Object.keys(input).length === 0;
  }
  if (toolName === DESIGN_PLAN_TOOL_NAME) {
    return DesignPlanContract.parse(input).ok;
  }
  if (toolName === DESIGN_REVIEW_TOOL_NAME) {
    return normalizeDesignVisualReviewToolInput(input) !== undefined;
  }
  if (toolName === DESIGN_CHECKPOINT_TOOL_NAME) {
    return DesignCheckpointContract.parse(input).ok;
  }
  if (toolName === READ_IMAGE_TOOL_NAME) {
    return ReadImageContract.parse(input).ok;
  }
  if (toolName === GENERATE_IMAGE_TOOL_NAME) {
    return GenerateImageContract.parse(input).ok;
  }
  if (toolName === PLACE_IMAGE_TOOL_NAME) {
    return PlaceImageContract.parse(input).ok;
  }
  if (toolName === UPDATE_IMAGE_TOOL_NAME) {
    return UpdateImageContract.parse(input).ok;
  }
  if (toolName === EDIT_IMAGE_TOOL_NAME) {
    return EditImageContract.parse(input).ok;
  }
  if (toolName === IMPORT_SVG_TOOL_NAME) return isImportSvgToolInput(input);
  if (toolName === EXPORT_SVG_TOOL_NAME) return isExportSvgToolInput(input);
  if (toolName === EXPORT_RASTER_TOOL_NAME) {
    return isExportRasterToolInput(input);
  }
  if (toolName === INTERNAL_IMPORT_SVG_TOOL_NAME) {
    return isInternalImportSvgToolInput(input);
  }
  if (toolName === INTERNAL_UPDATE_IMAGE_TOOL_NAME) {
    return isInternalUpdateImageToolInput(input);
  }
  if (toolName === INTERNAL_READ_IMAGE_SOURCE_TOOL_NAME) {
    return isInternalReadImageSourceToolInput(input);
  }
  if (toolName === DESIGN_HIERARCHY_TOOL_NAME) {
    return isDesignHierarchyToolInput(input);
  }
  if (toolName === DESIGN_ARRANGE_TOOL_NAME) {
    return isDesignArrangeToolInput(input);
  }
  if (toolName === DESIGN_VECTOR_TOOL_NAME) {
    return isDesignVectorToolInput(input);
  }
  if (toolName === DESIGN_FONT_TOOL_NAME) {
    return isDesignFontToolInput(input);
  }
  if (toolName === DESIGN_TEXT_RANGE_TOOL_NAME) {
    return isDesignTextRangeToolInput(input);
  }
  if (toolName === DESIGN_PAGE_TOOL_NAME) {
    return normalizeDesignPageToolInput(input) !== undefined;
  }
  if (toolName === DESIGN_COMPONENT_TOOL_NAME) {
    return isDesignComponentToolInput(input);
  }
  if (toolName === DESIGN_VARIABLE_TOOL_NAME) {
    return isDesignVariableToolInput(input);
  }
  if (toolName === DESIGN_STYLE_TOOL_NAME) {
    return isDesignStyleToolInput(input);
  }
  if (toolName === PAGE_STRUCTURE_ACCESS_TOOL_NAME) {
    return isPageStructureAccessToolInput(input);
  }
  if (
    toolName !== DESIGN_APPLY_TOOL_NAME &&
    toolName !== INTERNAL_DESIGN_APPLY_TOOL_NAME
  ) {
    return false;
  }
  if (toolName === DESIGN_APPLY_TOOL_NAME) {
    return DesignApplyContract.parse(input).ok;
  }
  return DesignApplyContract.parse(input, { internal: true }).ok;
}
