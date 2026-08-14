export type Tool =
  | "select"
  | "frame"
  | "rectangle"
  | "ellipse"
  | "line"
  | "arrow"
  | "polygon"
  | "star"
  | "pen"
  | "text";

export type SidebarTab = "layers" | "assets" | "styles" | "variables";

export function isTool(value: unknown): value is Tool {
  return (
    value === "select" ||
    value === "frame" ||
    value === "rectangle" ||
    value === "ellipse" ||
    value === "line" ||
    value === "arrow" ||
    value === "polygon" ||
    value === "star" ||
    value === "pen" ||
    value === "text"
  );
}
