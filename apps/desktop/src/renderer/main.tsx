import "@opendesign/ui/styles.css";
import { TooltipProvider } from "@opendesign/ui";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { EditorRuntimeProvider } from "./editor-runtime";
import { I18nProvider } from "./i18n";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Renderer root is missing");

createRoot(root).render(
  <StrictMode>
    <TooltipProvider>
      <I18nProvider>
        <EditorRuntimeProvider>
          <App />
        </EditorRuntimeProvider>
      </I18nProvider>
    </TooltipProvider>
  </StrictMode>,
);
