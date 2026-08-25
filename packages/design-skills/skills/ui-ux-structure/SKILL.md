---
name: ui-ux-structure
description: Turn a UI brief into a usable task hierarchy, semantic structure, states, and component decisions.
---

# UI and UX structure

Use this skill only for `deliverable=ui`. Preserve the user's product semantics and do not invent features to make a screen look richer.

Classify the current surface by success: `persuade` for deciding, `operate` for acting, `read` for understanding, or `experience` when the work leads. Record it in `designIntent.calibration.surfaceMode`; UI never uses `graphic`. Classify the surface, not the product: a design tool's landing page is persuade; its editor is operate. Order information by task and expose primary action, state, navigation, and recovery.

Operate favors familiar affordances, scan speed, states, focus, and restrained motion. Persuade needs an argument and subject evidence; read needs navigation and comprehension; experience lets the artifact lead without losing orientation. Character comes from precise details, not unfamiliar controls.

Design at the delivery viewport, not editor zoom. At fit-to-artboard size, copy and controls remain readable, realistic content fits, and the task is not stranded in decorative emptiness. Progressively disclose secondary controls.

Plan only relevant states—loading, empty, validation, error, success, disabled, selected, focus, or offline—and show recovery. A polished happy path alone is not complete UX evidence.

Build each screen as an editable target-specific hierarchy; never fake rows, controls, navigation, or data with one multiline Text, spaces, or arrows. Use separate labels, controls, surfaces, and visuals. Capture it before authoring the next screen.

Choose components for semantic reuse, stable identity, centralized updates, and controlled variation; repeated shapes are not automatically components. Preserve meaningful one-off groups. Inspect the current file's Components, Styles, and Variables before creating a parallel system. Reuse a catalog Component only when its semantic job and properties fit, then create a linked Instance; visual similarity alone is insufficient.

Keep hit targets, focus order, safe areas, text, contrast, and status meaning visible. Do not wrap every region in a card or give every action equal prominence. The first meaningful slice must establish the actionable hierarchy before decoration.
