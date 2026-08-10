# OpenDesign professional fixtures

This directory contains deterministic acceptance fixtures for the professional design roadmap. They are product evidence, not demo screenshots.

Each fixture keeps four distinct artifacts:

- `prompt.md`: the fixed user request used by later live Agent replay.
- `initial.opendesign`: the document immediately before the recorded refinement.
- `refinement.transaction.json`: one versioned OpenDesign transaction.
- `document.opendesign`: the expected document after that transaction.

`manifest.json` records stable IDs, expected structure, minimum feature use, evidence state, and SHA-256 digests. Run `pnpm fixtures:generate` after intentionally changing a fixture and `pnpm fixtures:check` in verification.

Current automated evidence proves schema validity, named hierarchy, formal Path use, effects/image projection, diagnostics, persistence, and transaction undo/redo. Pixel baselines, real Agent tool traces, `capture_canvas` artifacts, professional export, and macOS/Windows visual acceptance remain separate pending evidence and must not be inferred from these files.
