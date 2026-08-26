import type {
  GlobalImageGenerationSettings,
  ModelProfile,
  ModelProviderCatalog,
  ModelProviderProfile,
  ProviderConnectionResult,
  SaveGlobalImageGenerationSettingsRequest,
  SaveModelProviderProfileRequest,
  TestModelProviderConnectionRequest,
} from "./provider-config-contract-schemas";
import type { ValidationIssue } from "./contract-validation";

export function refineModelProviderCatalog(
  value: ModelProviderCatalog,
): ValidationIssue[] {
  const issues = value.providers.flatMap((provider, index) =>
    providerIssues(provider, `/providers/${index}`),
  );
  issues.push(
    ...duplicateIssues(
      value.providers.map((provider) => provider.providerId),
      "/providers",
      "provider_config.provider_id_duplicate",
      "Provider IDs must be unique within the catalog",
    ),
  );
  if (value.defaultSelection) {
    issues.push(
      ...selectionIssues(value.defaultSelection, "/defaultSelection"),
    );
    const provider = value.providers.find(
      (candidate) =>
        candidate.providerId === value.defaultSelection?.providerId,
    );
    const model = provider?.models.find(
      (candidate) => candidate.modelId === value.defaultSelection?.modelId,
    );
    if (!provider?.enabled || !model?.capabilities.toolUse) {
      issues.push(
        issue(
          "provider_config.default_selection_unavailable",
          "/defaultSelection",
          "Default selection must resolve to an enabled Provider model with Agent tool use",
        ),
      );
    } else if (
      value.defaultSelection.reasoningEffort !== undefined &&
      !model.reasoningEfforts.includes(value.defaultSelection.reasoningEffort)
    ) {
      issues.push(
        issue(
          "provider_config.default_reasoning_effort_unsupported",
          "/defaultSelection/reasoningEffort",
          "Default reasoning effort must be supported by the selected model",
        ),
      );
    }
  }
  return issues;
}

export function refineSaveModelProviderProfileRequest(
  value: SaveModelProviderProfileRequest,
): ValidationIssue[] {
  return [
    ...providerCoreIssues(value, "/"),
    ...(value.apiKey !== undefined && value.clearApiKey === true
      ? [
          issue(
            "provider_config.credential_action_conflict",
            "/clearApiKey",
            "A request cannot set and clear the Provider API key together",
          ),
        ]
      : []),
  ];
}

export function refineTestModelProviderConnectionRequest(
  value: TestModelProviderConnectionRequest,
): ValidationIssue[] {
  return selectionIssues(value, "/");
}

export function refineGlobalImageGenerationSettings(
  value: GlobalImageGenerationSettings,
): ValidationIssue[] {
  return [
    ...baseUrlIssues(value.baseUrl, "/baseUrl"),
    ...enabledModelIssues(value.enabled, value.modelId, "/modelId"),
    ...timestampIssues(value.updatedAt, "/updatedAt"),
  ];
}

export function refineSaveGlobalImageGenerationSettingsRequest(
  value: SaveGlobalImageGenerationSettingsRequest,
): ValidationIssue[] {
  return [
    ...baseUrlIssues(value.baseUrl, "/baseUrl"),
    ...enabledModelIssues(value.enabled, value.modelId, "/modelId"),
    ...(value.apiKey !== undefined && value.clearApiKey === true
      ? [
          issue(
            "provider_config.image_credential_action_conflict",
            "/clearApiKey",
            "A request cannot set and clear the image-generation API key together",
          ),
        ]
      : []),
  ];
}

export function refineProviderConnectionResult(
  value: ProviderConnectionResult,
): ValidationIssue[] {
  const latencies = [
    ["latencyMs", value.latencyMs],
    ["textLatencyMs", value.textLatencyMs],
    ["toolLatencyMs", value.toolLatencyMs],
  ] as const;
  return [
    ...(value.ok === (value.status === "compatible")
      ? []
      : [
          issue(
            "provider_config.connection_status_mismatch",
            "/ok",
            "Connection result ok must be true only for a compatible Provider",
          ),
        ]),
    ...latencies.flatMap(([name, latency]) =>
      latency === undefined || Number.isFinite(latency)
        ? []
        : [
            issue(
              "provider_config.connection_latency_invalid",
              `/${name}`,
              "Provider latency must be a finite non-negative number",
            ),
          ],
    ),
  ];
}

function providerIssues(
  value: ModelProviderProfile,
  path: string,
): ValidationIssue[] {
  return [
    ...providerCoreIssues(value, path),
    ...timestampIssues(value.updatedAt, `${path}/updatedAt`),
  ];
}

function providerCoreIssues(
  value: Pick<ModelProviderProfile, "baseUrl" | "models">,
  path: string,
): ValidationIssue[] {
  const prefix = path === "/" ? "" : path;
  return [
    ...baseUrlIssues(value.baseUrl, `${prefix}/baseUrl`),
    ...value.models.flatMap((model, index) =>
      modelIssues(model, `${prefix}/models/${index}`),
    ),
    ...duplicateIssues(
      value.models.map((model) => model.modelId),
      `${prefix}/models`,
      "provider_config.model_id_duplicate",
      "Model IDs must be unique within one Provider",
    ),
  ];
}

function modelIssues(value: ModelProfile, path: string): ValidationIssue[] {
  const declaresReasoning = value.reasoningEfforts.some(
    (effort) => effort !== "off",
  );
  return value.capabilities.reasoning === declaresReasoning
    ? []
    : [
        issue(
          "provider_config.reasoning_capability_mismatch",
          `${path}/reasoningEfforts`,
          "Reasoning capability must match the model's supported reasoning efforts",
        ),
      ];
}

function selectionIssues(
  value: TestModelProviderConnectionRequest,
  path: string,
): ValidationIssue[] {
  const prefix = path === "/" ? "" : path;
  return [
    ...(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(value.providerId)
      ? []
      : [
          issue(
            "provider_config.provider_id_invalid",
            `${prefix}/providerId`,
            "Provider ID must use stable alphanumeric, dot, underscore or dash characters",
          ),
        ]),
    ...(value.modelId.length > 0
      ? []
      : [
          issue(
            "provider_config.model_id_required",
            `${prefix}/modelId`,
            "Model ID is required",
          ),
        ]),
  ];
}

function baseUrlIssues(value: string, path: string): ValidationIssue[] {
  try {
    const url = new URL(value);
    const localHttp =
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    return (url.protocol === "https:" || localHttp) &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === ""
      ? []
      : [invalidBaseUrlIssue(path)];
  } catch {
    return [invalidBaseUrlIssue(path)];
  }
}

function invalidBaseUrlIssue(path: string): ValidationIssue {
  return issue(
    "provider_config.base_url_invalid",
    path,
    "Provider base URL must use HTTPS, or HTTP on localhost, without credentials, query or fragment",
  );
}

function timestampIssues(
  value: string | null,
  path: string,
): ValidationIssue[] {
  return value === null || Number.isFinite(Date.parse(value))
    ? []
    : [
        issue(
          "provider_config.timestamp_invalid",
          path,
          "Provider timestamp must be parseable",
        ),
      ];
}

function enabledModelIssues(
  enabled: boolean,
  modelId: string,
  path: string,
): ValidationIssue[] {
  return !enabled || modelId.length > 0
    ? []
    : [
        issue(
          "provider_config.image_model_required",
          path,
          "Enabled image generation requires a model ID",
        ),
      ];
}

function duplicateIssues(
  values: readonly string[],
  path: string,
  code: string,
  message: string,
): ValidationIssue[] {
  return new Set(values).size === values.length
    ? []
    : [issue(code, path, message)];
}

function issue(code: string, path: string, message: string): ValidationIssue {
  return {
    code,
    path: path || "/",
    message,
    recovery: "Correct the reported Provider configuration field and retry.",
  };
}
