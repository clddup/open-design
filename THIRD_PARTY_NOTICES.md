# Third-Party Notices

OpenDesign uses third-party packages recorded in its package manifests and lockfile. This file records the repository-level notice status on 2026-08-10; it is not a substitute for a release-time inventory and license bundle covering all JavaScript, Electron/native, font, model, and asset dependencies.

## Direct vendored components

There are currently no direct vendored source components in the repository. OpenPencil and its nested Jian, agent-rs, and Casement checkouts were removed together with the OpenPencil runtime, build entries, and packaged resources. They are not distributed by the current OpenDesign package.

Removing a vendored component removes its distribution notice from this file; it does not erase historical architectural research. ADR references to OpenPencil, OpenCode, Codex, Claude Code, Cline, Continue, or ZCode describe design inputs only and do not mean their source code is included or their names endorse OpenDesign. Pi is both an architectural reference and, for the package identified below, a declared dependency.

## Package dependencies

The authoritative development dependency graph is pinned by `pnpm-lock.yaml`, while each workspace package declares its direct dependencies in its own `package.json`. The current desktop package includes Electron, React, Vite/Rolldown build output, Bytenode support for protected Main and Agent entries, and the transitive packages required by the bundled application.

`@opendesign/ui` directly uses `@base-ui/react` 1.7.0 from [Base UI](https://github.com/mui/base-ui). It is distributed under the MIT License, Copyright (c) 2019 Material-UI SAS. It provides headless interaction and accessibility behavior behind OpenDesign-owned component APIs and styling; OpenDesign desktop features do not import it directly.

`@opendesign/leafer-engine` directly uses `leafer-editor` 2.2.9 from [LeaferJS](https://github.com/leaferjs/leafer-ui). It and its integrated official Leafer UI/Editor/Viewport/Resize/TextEditor packages are distributed under the MIT License, Copyright © 2023-present Chao (Leafer) Wan. OpenDesign uses them behind an adapter for Renderer canvas rendering, scene projection, viewport, hit testing, selection and direct manipulation. OpenDesign project files retain the OpenDesign document format; Leafer private scene serialization is not a persistence or Agent boundary.

`@opendesign/model-gateway` and `@opendesign/agent-runtime` directly use `@earendil-works/pi-ai` 0.84.1 from [earendil-works/pi](https://github.com/earendil-works/pi/tree/main/packages/ai). It is distributed under the MIT License. OpenDesign uses its typed messages and event stream at the Pi Agent boundary, plus OpenAI Responses, OpenAI Chat Completions and Anthropic Messages streaming adapters behind an OpenDesign-owned canonical event and Main credential boundary.

`@opendesign/agent-runtime` uses and contract-tests `@earendil-works/pi-agent-core` 0.84.1 from [earendil-works/pi](https://github.com/earendil-works/pi/tree/main/packages/agent). It is distributed under the MIT License, Copyright (c) 2025 Mario Zechner. The Agent utility process production entry uses only the implemented headless `Agent` loop with explicit OpenDesign tools and sequential execution; OpenDesign-owned adapters retain the Model Gateway, journal, context, permissions, approval, revision and design transaction boundaries. OpenDesign does not depend on `@earendil-works/pi-coding-agent` or `@earendil-works/pi-tui`, and does not enable Pi filesystem, shell, credential discovery, extension discovery, session files or TUI surfaces. The pinned package exports an `AgentHarness`, but its runtime `prompt()` is not implemented at this version and is therefore rejected by the baseline gate.

`@opendesign/geometry-service` directly uses `pathkit-wasm` 1.0.0 from [Google Skia PathKit](https://github.com/google/skia/tree/main/modules/pathkit). It is distributed under the BSD 3-Clause License, Copyright (c) 2018 Google LLC. OpenDesign loads it through an isolated, on-demand vector-path provider for bounded SVG path operations and disposable Boolean render geometry; PathKit objects and WASM state do not enter design documents, persistent Renderer state, Agent schemas or public contracts.

`@opendesign/desktop` directly uses `unpdf` 1.8.0 from [unjs/unpdf](https://github.com/unjs/unpdf). It is distributed under the MIT License, Copyright (c) 2023-PRESENT Johann Schopplich. OpenDesign uses its PDF.js-backed text extraction for user-selected Agent document attachments; the optional `@napi-rs/canvas` rendering peer is not installed or used.

`@opendesign/desktop` directly uses `mammoth` 1.12.0 from [mwilliamson/mammoth.js](https://github.com/mwilliamson/mammoth.js). It is distributed under the BSD 2-Clause License, Copyright (c) 2013 Michael Williamson. OpenDesign uses `extractRawText` for user-selected DOCX Agent attachments after host-side archive validation.

Before distribution, generate a machine-readable inventory from the lockfile and the actual packaged artifact, resolve every package's license and required notice text, and ship the resulting license bundle. Do not infer that a dependency is absent merely because it is bundled into ASAR or JavaScript output.

## Architecture references

Project documentation mentions third-party products and projects as architectural references for Agent, editor, and security design. A reference does not mean source code is included. If code or other copyrightable material from a reference project is introduced later, add the exact project, source revision, license, copyright notice, modification note, and required license text before distribution.

## Release requirements

Before producing a distributable build:

1. Generate inventories from every active package and native lockfile, including bundled fonts, icons, models, WASM, binaries, and assets.
2. Compare the inventories with the actual packaged artifact instead of relying only on development manifests.
3. Retain all required copyright, license, attribution, patent, and `NOTICE` materials.
4. Review copyleft, source-offer, non-code asset, and model/data terms separately.
5. Update this file and `docs/engine-baseline.json` whenever a vendored component, fixed runtime baseline, or packaged dependency set changes.
6. Rebuild the packaged application after changing this file so `Contents/Resources/THIRD_PARTY_NOTICES.md` is not stale.

OpenDesign makes no additional warranty for third-party software. Each component remains subject to its own license terms.
