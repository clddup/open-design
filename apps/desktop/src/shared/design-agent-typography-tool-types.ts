import type {
  DesignOperation,
  TextFontDescriptor,
} from "@opendesign/design-contracts";

export type DesignFontToolInput =
  | {
      action: "reflow";
      label: string;
      pageId: string;
      nodeIds: string[];
      expectedFont: TextFontDescriptor;
    }
  | {
      action: "replace";
      label: string;
      pageId: string;
      nodeIds: string[];
      expectedFont: TextFontDescriptor;
      replacementFont: TextFontDescriptor;
    };

export type DesignTextRangeToolInput = {
  label: string;
  pageId: string;
  nodeId: string;
  start: number;
  end: number;
  style: Extract<DesignOperation, { type: "update_text_range_style" }>["style"];
};
