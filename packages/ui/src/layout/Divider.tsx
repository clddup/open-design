export function Divider({
  orientation = "vertical",
}: {
  orientation?: "horizontal" | "vertical";
}) {
  return (
    <span
      aria-hidden="true"
      className={`ui-divider ui-divider--${orientation}`}
    />
  );
}
