# OpenDesign design evaluation

This directory defines fixed live-Agent evaluation scenarios. It does not contain generated designs and does not claim visual quality evidence by itself.

Each scenario fixes the user prompt, generation mode, target count, model context budget, and non-compensating blind-review criteria. `OD-MARK-01` additionally sets packaged-run budgets for a focused single mark: `T1 <= 60 s` and `T_all <= 5 min`. These budgets fail evaluation evidence only; they do not interrupt an ordinary user Run or weaken visual quality gates. A real packaged OpenDesign run must later provide a validated evidence report containing performance milestones, final captures, the final `.opendesign` document, the initial protocol size and tool surface, and independent Critic results for every final target.

Use:

```bash
pnpm evaluation:check
node scripts/design-evaluation.mjs prepare --output <dir> --seed <seed> <evidence-dir> <evidence-dir> [...]
node scripts/design-evaluation.mjs score --bundle <dir> --ratings <ratings.json>
```

`prepare` writes anonymous review material under `<dir>/review` and keeps the identity mapping in `<dir>/key.json`. Give reviewers only the `review` directory. `score` verifies ratings against the packet and emits `<dir>/score.json` with host-derived non-compensating pass/fail.

Structural fixtures under `fixtures/professional` remain separate. They prove deterministic document/runtime behavior, not live model speed or visual quality.
