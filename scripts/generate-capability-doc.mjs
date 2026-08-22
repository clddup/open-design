import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { format } from "prettier";

const root = resolve(import.meta.dirname, "..");
const manifestPath = resolve(
  root,
  "packages/design-capabilities/src/manifest.json",
);
const outputs = [
  {
    path: resolve(root, "docs/generated/design-capabilities.md"),
    render: renderHelp,
  },
  {
    path: resolve(root, "docs/generated/design-capability-release-summary.md"),
    render: renderReleaseSummary,
  },
];
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

validateManifest(manifest);

for (const output of outputs) {
  const content = await format(output.render(manifest), {
    parser: "markdown",
    proseWrap: "preserve",
  });
  await mkdir(resolve(output.path, ".."), { recursive: true });
  await writeFile(output.path, content, "utf8");
  console.log(`Updated ${relative(output.path)}`);
}

function renderHelp(source) {
  const counts = statusCounts(source.capabilities);
  const lines = [
    generatedNotice(),
    "# OpenDesign 专业设计能力",
    "",
    `能力清单版本：\`${source.version}\` · 更新日期：${source.updatedAt} · 文档协议：\`${source.documentSchemaVersion}\` · 画布基线：\`${source.engineBaseline}\``,
    "",
    `当前状态：可用 ${counts.available} 项，降级可用 ${counts.degraded} 项，不可用 ${counts.unavailable} 项。只有必需表面全部可用，并同时具备自动化与实机证据时，能力才允许标记为“可用”。`,
    "",
  ];
  for (const category of source.categories) {
    const capabilities = source.capabilities.filter(
      (capability) => capability.category === category.id,
    );
    if (capabilities.length === 0) continue;
    lines.push(`## ${category.label["zh-CN"]}`, "");
    for (const capability of capabilities) {
      lines.push(
        `### ${capability.label["zh-CN"]} — ${statusLabel(capability.status)}`,
        "",
        capability.description["zh-CN"],
        "",
        `- ID：\`${capability.id}\``,
        `- 实现方：${capability.provider}`,
        `- 表面：${surfaceSummary(capability.surfaces)}`,
        `- 证据：自动化 ${capability.evidence.automated.length} 项；实机 ${capability.evidence.manual.length} 项`,
      );
      for (const limitation of capability.limitations) {
        lines.push(`- 限制：${limitation["zh-CN"]}`);
      }
      for (const reference of capability.references) {
        lines.push(`- 专业参照：[官方说明](${reference})`);
      }
      lines.push("");
    }
  }
  return `${lines.join("\n").trim()}\n`;
}

function renderReleaseSummary(source) {
  const counts = statusCounts(source.capabilities);
  const lines = [
    generatedNotice(),
    "# Design capability release summary",
    "",
    `Manifest v${source.version} (${source.updatedAt}) · ${counts.available} available · ${counts.degraded} degraded · ${counts.unavailable} unavailable`,
    "",
    "This block is the release-note view of the same manifest used by the built-in Agent and generated help. It must not be edited by hand.",
    "",
  ];
  for (const status of ["available", "degraded", "unavailable"]) {
    lines.push(`## ${statusLabelEnglish(status)}`, "");
    const capabilities = source.capabilities.filter(
      (capability) => capability.status === status,
    );
    if (capabilities.length === 0) {
      lines.push("- None", "");
      continue;
    }
    for (const capability of capabilities) {
      lines.push(`- \`${capability.id}\` — ${capability.label.en}`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trim()}\n`;
}

function validateManifest(source) {
  if (source?.version !== 1 || !Array.isArray(source.capabilities)) {
    throw new TypeError("Unsupported design capability manifest");
  }
  const ids = new Set();
  for (const capability of source.capabilities) {
    if (ids.has(capability.id)) {
      throw new TypeError(`Duplicate capability ID: ${capability.id}`);
    }
    ids.add(capability.id);
    const required = capability.requiredSurfaces.map(
      (surface) => capability.surfaces[surface],
    );
    const expected = required.every((status) => status === "unavailable")
      ? "unavailable"
      : required.some((status) => status !== "available") ||
          capability.evidence.automated.length === 0 ||
          capability.evidence.manual.length === 0
        ? "degraded"
        : "available";
    if (capability.status !== expected) {
      throw new TypeError(
        `Capability ${capability.id} declares ${capability.status}; expected ${expected}`,
      );
    }
  }
}

function statusCounts(capabilities) {
  const counts = { available: 0, degraded: 0, unavailable: 0 };
  for (const capability of capabilities) counts[capability.status] += 1;
  return counts;
}

function surfaceSummary(surfaces) {
  return Object.entries(surfaces)
    .map(([surface, status]) => `${surface}=${status}`)
    .join("；");
}

function statusLabel(status) {
  return status === "available"
    ? "可用"
    : status === "degraded"
      ? "降级可用"
      : "不可用";
}

function statusLabelEnglish(status) {
  return status[0].toUpperCase() + status.slice(1);
}

function generatedNotice() {
  return "<!-- Generated from packages/design-capabilities/src/manifest.json. Do not edit by hand. -->";
}

function relative(path) {
  return path.slice(root.length + 1);
}
