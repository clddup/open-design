---
name: ui-ux-structure
description: Turn a UI brief into a usable task hierarchy, semantic structure, states, and component decisions.
---

# UI and UX structure

Use this skill only for `deliverable=ui`. Preserve the user's product semantics and do not invent features to make a screen look richer.

Define the primary user job and classify the current surface by success: `persuade` for deciding, `operate` for completing a task, `read` for understanding, or `experience` when the work leads. Record that exact choice in `designIntent.calibration.surfaceMode`; UI must never use `graphic`. Classify the surface, not the product: a design tool's landing page is persuade; its editor is operate. Arrange information in task order and expose the primary action, current state, navigation context, and recovery without forcing recall.

Operate favors familiar affordances, scan speed, stable density, complete states, keyboard/focus behavior, and restrained state motion. Persuade needs a clear argument and relevant subject evidence. Read prioritizes navigation, measure, and comprehension. Experience lets the artifact lead without losing orientation. Product character comes from precise details, not unfamiliar controls.

Design for the delivery viewport, not enlarged editor zoom. At fit-to-artboard size, labels remain readable, controls do not become texture, realistic copy fits, and the task is not stranded in a small card amid decorative emptiness. Use progressive disclosure for secondary controls.

Plan only relevant states—loading, empty, validation, error, success, disabled, selected, focus, or offline—and show recovery. A polished happy path alone is not complete UX evidence.

Choose components for semantic reuse, stable identity, centralized updates, and controlled variation; repeated shapes are not automatically components. Preserve meaningful one-off groups. Inspect the current file's Components, Styles, and Variables before creating a parallel system. Reuse a catalog Component only when its semantic job and properties fit, then create a linked Instance; visual similarity alone is insufficient.

Keep hit targets, focus order, safe areas, text, contrast, and status meaning visible. Do not wrap every region in a card or give every action equal prominence. The first meaningful slice must establish the actionable hierarchy before decoration.
