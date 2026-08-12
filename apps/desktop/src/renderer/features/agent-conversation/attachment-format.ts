import type { AgentAttachment } from "@opendesign/agent-contracts";
import type { AgentAttachmentSelection } from "../../../shared/desktop-api";

export function toAgentAttachment(
  selection: AgentAttachmentSelection,
): AgentAttachment {
  return {
    attachmentId: selection.attachmentId,
    name: selection.name,
    mimeType: selection.mimeType,
    byteSize: selection.byteSize,
  };
}

export function isImageAttachment(
  attachment: AgentAttachment | AgentAttachmentSelection,
): boolean {
  return attachment.attachmentId.startsWith("image_");
}

export function formatAttachmentKind(
  mimeType: AgentAttachment["mimeType"],
): string {
  const labels: Partial<Record<AgentAttachment["mimeType"], string>> = {
    "image/svg+xml": "SVG",
    "application/pdf": "PDF",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      "DOCX",
    "text/plain": "TXT",
    "text/markdown": "Markdown",
    "text/csv": "CSV",
    "text/html": "HTML",
    "application/json": "JSON",
    "application/yaml": "YAML",
  };
  return labels[mimeType] ?? mimeType.slice("image/".length).toUpperCase();
}

export function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
