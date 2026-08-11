export type Tool =
  "select" | "frame" | "rectangle" | "ellipse" | "line" | "arrow" | "text";

export type SidebarTab = "layers" | "assets";

export function isTool(value: unknown): value is Tool {
  return (
    value === "select" ||
    value === "frame" ||
    value === "rectangle" ||
    value === "ellipse" ||
    value === "line" ||
    value === "arrow" ||
    value === "text"
  );
}
