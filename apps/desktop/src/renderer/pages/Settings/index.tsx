import { useOutletContext } from "react-router-dom";
import type { AppRouteContext } from "../../router/route-context";
import { SettingsPage as SettingsView } from "./SettingsView";

export function SettingsPage() {
  const { settings } = useOutletContext<AppRouteContext>();
  return <SettingsView {...settings} />;
}
