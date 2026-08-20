# `@opendesign/ui`

`@opendesign/ui` is the shared visual and interaction boundary for OpenDesign's desktop Renderer. Desktop features import its stable APIs instead of importing component-library packages directly.

## Foundation

- OpenDesign owns the visual tokens, density, themes, glyphs, buttons, dividers, resize handles, canvas controls, and desktop chrome.
- `Dialog`, `ConfirmDialog`, `Tooltip`, `TooltipProvider`, `DropdownMenu`, `DropdownMenuItem`, `DropdownMenuSeparator`, and the context-bound Message API wrap selected `@base-ui/react` primitives for focus lifecycle, keyboard navigation, Escape dismissal, collision handling, timed feedback, live-region announcements, stack limiting, and portal behavior.
- `@base-ui/react` is package-private. Desktop features import stable OpenDesign APIs and do not couple themselves to Base UI component types or composition.
- Tailwind and shadcn are not part of the package. OpenDesign's semantic tokens and `.ui-*` styles remain the sole visual layer.
- Simple visual primitives and editor-specific controls remain custom. Headless primitives are added only when they remove meaningful interaction or accessibility risk.

Add another third-party primitive only when it removes meaningful interaction or accessibility risk in a real workflow. Product-specific controls should remain custom when a generic primitive adds no behavioral value.
