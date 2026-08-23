import { useOutletContext } from "react-router-dom";
import { SettingsFeature } from "@/renderer/features/settings";
import type { AppRouteContext } from "@/renderer/router/route-context";

export function SettingsPage() {
  const { settings } = useOutletContext<AppRouteContext>();
  return <SettingsFeature {...settings} />;
}
