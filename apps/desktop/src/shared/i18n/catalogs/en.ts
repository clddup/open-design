import { mergeCatalogs } from "./merge-catalogs";
import { appShellMessages } from "./features/app-shell/en";
import { settingsMessages } from "./features/settings/en";
import { workspaceMessages } from "./features/workspace/en";
import { agentConversationMessages } from "./features/agent-conversation/en";
import { diagnosticMessages } from "./features/diagnostics/en";
import { canvasMessages } from "./features/canvas/en";
import { sidebarMessages } from "./features/sidebar/en";
import { propertyMessages } from "./features/properties/en";
import { editorMessages } from "./features/editor/en";
import { workbenchMessages } from "./features/workbench/en";
import { nativeDialogMessages } from "./features/native-dialog/en";
import { importExportMessages } from "./features/import-export/en";
import { imageMessages } from "./features/image/en";
import { layoutMessages } from "./features/layout/en";
import { componentMessages } from "./features/component/en";
import { variableMessages } from "./features/variable/en";
import { styleMessages } from "./features/style/en";
import { typographyMessages } from "./features/typography/en";

export const enMessages = mergeCatalogs(
  appShellMessages,
  settingsMessages,
  workspaceMessages,
  agentConversationMessages,
  diagnosticMessages,
  canvasMessages,
  sidebarMessages,
  propertyMessages,
  editorMessages,
  workbenchMessages,
  nativeDialogMessages,
  importExportMessages,
  imageMessages,
  layoutMessages,
  componentMessages,
  variableMessages,
  styleMessages,
  typographyMessages,
);
