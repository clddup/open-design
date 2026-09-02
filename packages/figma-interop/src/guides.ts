import type { Guide as OpenDesignGuide } from "@opendesign/design-contracts";

export function fromFigmaGuides(guides: readonly Guide[]): OpenDesignGuide[] {
  return guides.map(({ axis, offset }) => ({ axis, offset }));
}

export function toFigmaGuides(guides: readonly OpenDesignGuide[]): Guide[] {
  return guides.map(({ axis, offset }) => ({ axis, offset }));
}
