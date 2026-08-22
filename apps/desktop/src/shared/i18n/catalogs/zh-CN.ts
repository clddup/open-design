import { mergeCatalogs } from "./merge-catalogs";
import type { enMessages } from "./en";
import { appShellMessages } from "./features/app-shell/zh-CN";
import { settingsMessages } from "./features/settings/zh-CN";
import { workspaceMessages } from "./features/workspace/zh-CN";
import { agentConversationMessages } from "./features/agent-conversation/zh-CN";
import { diagnosticMessages } from "./features/diagnostics/zh-CN";
import { canvasMessages } from "./features/canvas/zh-CN";
import { sidebarMessages } from "./features/sidebar/zh-CN";
import { propertyMessages } from "./features/properties/zh-CN";
import { editorMessages } from "./features/editor/zh-CN";
import { workbenchMessages } from "./features/workbench/zh-CN";
import { nativeDialogMessages } from "./features/native-dialog/zh-CN";
import { importExportMessages } from "./features/import-export/zh-CN";
import { imageMessages } from "./features/image/zh-CN";
import { layoutMessages } from "./features/layout/zh-CN";
import { componentMessages } from "./features/component/zh-CN";
import { variableMessages } from "./features/variable/zh-CN";
import { styleMessages } from "./features/style/zh-CN";
import { typographyMessages } from "./features/typography/zh-CN";

export const zhCNMessages = mergeCatalogs(
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
) satisfies Record<keyof typeof enMessages, string>;
