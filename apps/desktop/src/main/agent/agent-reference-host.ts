import {
  MAX_AGENT_ATTACHMENT_BYTES,
  type AgentAttachment,
  type AgentImageAttachment,
  type AgentRequest,
  type AgentSvgAttachment,
} from "@opendesign/agent-contracts";
import type {
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-runtime";
import { basename, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReadImageToolInput } from "../../shared/design-agent-tools";
import type { AgentAttachmentHost } from "./agent-attachment-host";

type RunStartRequest = Extract<AgentRequest, { type: "run.start" }>;

type RunReferences = {
  attachments: Map<string, AgentAttachment>;
  prompt: string;
};

const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 15_000;

export class AgentReferenceHost {
  readonly #runs = new Map<string, RunReferences>();

  constructor(
    private readonly attachments: AgentAttachmentHost,
    private readonly fetchImplementation: typeof globalThis.fetch = globalThis.fetch,
    private readonly fetchTimeoutMs = FETCH_TIMEOUT_MS,
  ) {}

  registerRun(request: RunStartRequest): void {
    this.#runs.set(request.runId, {
      attachments: new Map(
        (request.attachments ?? []).map((attachment) => [
          attachment.attachmentId,
          attachment,
        ]),
      ),
      prompt: request.prompt,
    });
  }

  releaseRun(runId: string): void {
    this.#runs.delete(runId);
  }

  registerGeneratedImage(
    attachment: AgentImageAttachment,
    context: TrustedToolContext,
  ): AgentImageAttachment {
    const references = this.#runs.get(context.runId);
    if (!references) {
      throw new Error("Image-generation run is no longer active");
    }
    if (!isImageAttachment(attachment)) {
      throw new TypeError("Generated attachment is not an image");
    }
    const snapshot = { ...attachment };
    references.attachments.set(snapshot.attachmentId, snapshot);
    return snapshot;
  }

  hasAuthorizedImage(
    attachmentId: string,
    context: TrustedToolContext,
  ): boolean {
    const metadata = this.#runs
      .get(context.runId)
      ?.attachments.get(attachmentId);
    return metadata !== undefined && isImageAttachment(metadata);
  }

  async readImage(
    input: ReadImageToolInput,
    context: TrustedToolContext,
    signal: AbortSignal,
  ): Promise<TrustedToolResult> {
    const references = this.#runs.get(context.runId);
    if (!references) throw new Error("Image reference run is no longer active");
    const source = input.source.trim();
    if (!source) throw new TypeError("Image source is empty");

    const attached = references.attachments.get(source);
    let selected: AgentImageAttachment;
    let sourceKind: "attachment" | "local-path" | "url";
    if (attached) {
      if (!isImageAttachment(attached)) {
        throw new TypeError("The referenced attachment is not an image");
      }
      const resolved = await this.attachments.resolve(attached.attachmentId);
      if (resolved.kind !== "image") {
        throw new TypeError("The referenced attachment is not an image");
      }
      selected = attached;
      sourceKind = "attachment";
    } else {
      if (!references.prompt.includes(source)) {
        throw new Error(
          "Image source was not explicitly referenced by the user in this run",
        );
      }
      const url = parseHttpUrl(source);
      if (url) {
        selected = await this.fetchImage(url, signal);
        sourceKind = "url";
      } else {
        const path = source.startsWith("file:")
          ? fileURLToPath(new URL(source))
          : source;
        if (!isAbsolute(path)) {
          throw new TypeError("Local image references must be absolute paths");
        }
        const imported = await this.attachments.importFiles([path]);
        const importedImage = imported[0];
        if (!importedImage || !isImageAttachment(importedImage)) {
          throw new TypeError("The referenced local file is not an image");
        }
        selected = importedImage;
        sourceKind = "local-path";
      }
    }

    const attachment: AgentImageAttachment = {
      attachmentId: selected.attachmentId,
      name: selected.name,
      mimeType: selected.mimeType,
      byteSize: selected.byteSize,
    };
    references.attachments.set(attachment.attachmentId, attachment);
    return {
      content: {
        ok: true,
        sourceKind,
        attachment,
        attachments: [attachment],
      },
    };
  }

  async materializeImage(
    attachmentId: string,
    context: TrustedToolContext,
  ): Promise<{
    attachment: AgentImageAttachment;
    data: string;
    mimeType: AgentImageAttachment["mimeType"];
  }> {
    const references = this.#runs.get(context.runId);
    const metadata = references?.attachments.get(attachmentId);
    if (!metadata || !isImageAttachment(metadata)) {
      throw new Error("Image attachment is not authorized for this run");
    }
    const resolved = await this.attachments.resolve(attachmentId);
    if (
      resolved.kind !== "image" ||
      resolved.mimeType !== metadata.mimeType ||
      resolved.byteSize !== metadata.byteSize
    ) {
      throw new Error("Image attachment metadata failed verification");
    }
    return {
      attachment: metadata,
      data: resolved.data,
      mimeType: resolved.mimeType,
    };
  }

  async materializeSvg(
    attachmentId: string,
    context: TrustedToolContext,
    signal: AbortSignal,
  ): Promise<{ attachment: AgentSvgAttachment; svg: string }> {
    throwIfAborted(signal);
    const references = this.#runs.get(context.runId);
    const metadata = references?.attachments.get(attachmentId);
    if (!metadata || !isSvgAttachment(metadata)) {
      throw new Error("SVG attachment is not authorized for this run");
    }
    const resolved = await this.attachments.resolve(attachmentId);
    throwIfAborted(signal);
    if (
      resolved.kind !== "svg" ||
      resolved.mimeType !== metadata.mimeType ||
      resolved.byteSize !== metadata.byteSize
    ) {
      throw new Error("SVG attachment metadata failed verification");
    }
    return {
      attachment: { ...metadata },
      svg: resolved.svg,
    };
  }

  private async fetchImage(
    initialUrl: URL,
    signal: AbortSignal,
  ): Promise<AgentImageAttachment> {
    let url = initialUrl;
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
      throwIfAborted(signal);
      const controller = new AbortController();
      const abort = () => controller.abort(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      const timeout = setTimeout(
        () =>
          controller.abort(
            new DOMException("Remote image read timed out", "TimeoutError"),
          ),
        this.fetchTimeoutMs,
      );
      try {
        const response = await this.fetchImplementation(url, {
          redirect: "manual",
          signal: controller.signal,
          headers: {
            accept: "image/avif,image/webp,image/png,image/jpeg,image/gif",
          },
        });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          if (!location || redirect === MAX_REDIRECTS) {
            throw new Error("Image URL exceeded the redirect limit");
          }
          url = requireHttpUrl(new URL(location, url));
          continue;
        }
        if (!response.ok) {
          throw new Error(`Image URL returned HTTP ${response.status}`);
        }
        const declaredLength = Number(response.headers.get("content-length"));
        if (
          Number.isFinite(declaredLength) &&
          declaredLength > MAX_AGENT_ATTACHMENT_BYTES
        ) {
          throw new RangeError("Remote image exceeds the 16 MB limit");
        }
        const bytes = await readBoundedBody(
          response,
          MAX_AGENT_ATTACHMENT_BYTES,
          controller.signal,
        );
        const selected = await this.attachments.importImageBytes(
          basename(url.pathname) || "remote-image",
          bytes,
        );
        return {
          attachmentId: selected.attachmentId,
          name: selected.name,
          mimeType: selected.mimeType,
          byteSize: selected.byteSize,
        };
      } finally {
        clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
      }
    }
    throw new Error("Image URL could not be resolved");
  }
}

function isImageAttachment(
  attachment: AgentAttachment,
): attachment is AgentImageAttachment {
  return (
    attachment.attachmentId.startsWith("image_") &&
    attachment.mimeType.startsWith("image/")
  );
}

function isSvgAttachment(
  attachment: AgentAttachment,
): attachment is AgentSvgAttachment {
  return (
    attachment.attachmentId.startsWith("svg_") &&
    attachment.mimeType === "image/svg+xml"
  );
}

function parseHttpUrl(value: string): URL | null {
  try {
    return requireHttpUrl(new URL(value));
  } catch {
    return null;
  }
}

function requireHttpUrl(url: URL): URL {
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password
  ) {
    throw new TypeError(
      "Image URL must use HTTP(S) without embedded credentials",
    );
  }
  return url;
}

async function readBoundedBody(
  response: Response,
  maximum: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  throwIfAborted(signal);
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    throwIfAborted(signal);
    if (bytes.byteLength > maximum) {
      throw new RangeError("Remote image exceeds the 16 MB limit");
    }
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const abort = () => {
    void reader.cancel(signal.reason).catch(() => undefined);
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    throwIfAborted(signal);
    while (true) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await reader.read();
      } catch (error) {
        throwIfAborted(signal);
        throw error;
      }
      throwIfAborted(signal);
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maximum) {
        await reader.cancel();
        throw new RangeError("Remote image exceeds the 16 MB limit");
      }
      chunks.push(result.value);
    }
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException("Image read cancelled", "AbortError");
}
