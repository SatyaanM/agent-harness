"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  fetchModels,
  fetchSettings,
  type HarnessSettings,
  type ModelInfo,
  type ProviderEntry,
  testProviderConnection,
  updateSettings,
} from "@/lib/api";

const FIELD_LABELS: Record<Exclude<keyof HarnessSettings, "PROVIDERS">, string> = {
  ROOT: "Root Directory",
  INBOX_ROOT: "Inbox Directory",
  SESSIONS_DIR: "Sessions Directory",
  AGENTS_DIR: "Agents Directory",
  PROVIDER_ENDPOINT: "Provider Endpoint",
  API_KEY_ENV: "API Key Environment Variable",
  DEFAULT_MODEL: "Default Model",
  MAX_CONCURRENT_AGENTS: "Max Concurrent Agents",
};

type EditableSetting = Exclude<keyof HarnessSettings, "ROOT" | "PROVIDERS">;

const PATH_FIELDS: EditableSetting[] = ["INBOX_ROOT", "SESSIONS_DIR", "AGENTS_DIR"];
const URL_FIELDS: EditableSetting[] = ["PROVIDER_ENDPOINT"];
const NUMBER_FIELDS: EditableSetting[] = ["MAX_CONCURRENT_AGENTS"];
const SETTINGS_FIELDS = [
  "INBOX_ROOT",
  "SESSIONS_DIR",
  "AGENTS_DIR",
  "PROVIDER_ENDPOINT",
  "API_KEY_ENV",
  "DEFAULT_MODEL",
  "MAX_CONCURRENT_AGENTS",
] as const satisfies readonly EditableSetting[];

function editableSettings(settings: HarnessSettings): Pick<HarnessSettings, EditableSetting> {
  return {
    INBOX_ROOT: settings.INBOX_ROOT,
    SESSIONS_DIR: settings.SESSIONS_DIR,
    AGENTS_DIR: settings.AGENTS_DIR,
    PROVIDER_ENDPOINT: settings.PROVIDER_ENDPOINT,
    API_KEY_ENV: settings.API_KEY_ENV,
    DEFAULT_MODEL: settings.DEFAULT_MODEL,
    MAX_CONCURRENT_AGENTS: settings.MAX_CONCURRENT_AGENTS,
  };
}

export function SettingsForm() {
  const [settings, setSettings] = useState<HarnessSettings | null>(null);
  const [draft, setDraft] = useState<Partial<Pick<HarnessSettings, EditableSetting>>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProviderEntry[]>([]);
  const [providerKeys, setProviderKeys] = useState<string[]>([]);
  const [providerStatus, setProviderStatus] = useState<Record<string, string>>({});
  const nextProviderKey = useRef(0);

  const loadModels = useCallback(async () => {
    setModelsLoading(true);
    setModelsError(null);
    try {
      const data = await fetchModels();
      setAvailableModels(data.data || []);
    } catch {
      setModelsError("Unable to load provider models. The configured model is preserved.");
    } finally {
      setModelsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings()
      .then((data) => {
        setSettings(data);
        setDraft(editableSettings(data));
        setProviders(data.PROVIDERS ?? []);
        setProviderKeys((data.PROVIDERS ?? []).map(() => `provider-${nextProviderKey.current++}`));
      })
      .catch(() => setError("Failed to load settings"));

    void loadModels();
  }, [loadModels]);

  const modelOptions = useMemo(() => {
    const configuredModel = String(draft.DEFAULT_MODEL ?? "");
    if (!configuredModel || availableModels.some((model) => model.id === configuredModel)) {
      return availableModels;
    }
    return [
      {
        id: configuredModel,
        object: "model",
        created: 0,
        owned_by: "configured",
      },
      ...availableModels,
    ];
  }, [availableModels, draft.DEFAULT_MODEL]);

  function validate(field: EditableSetting, value: string): string {
    if (!value.trim()) return "Required";
    if (PATH_FIELDS.includes(field) && !value.startsWith("/") && !value.match(/^[A-Z]:\\/i)) {
      return "Must be an absolute path";
    }
    if (URL_FIELDS.includes(field)) {
      try {
        new URL(value);
      } catch {
        return "Must be a valid URL";
      }
    }
    if (NUMBER_FIELDS.includes(field) && (Number.isNaN(Number(value)) || Number(value) < 1)) {
      return "Must be a positive number";
    }
    return "";
  }

  function handleChange(field: EditableSetting, value: string) {
    setDraft((prev) => ({ ...prev, [field]: value }));
    const err = validate(field, value);
    setValidationErrors((prev) => {
      const next = { ...prev };
      if (err) next[field] = err;
      else delete next[field];
      return next;
    });
    setSuccess(false);
  }

  async function handleSave() {
    const errors: Record<string, string> = {};
    for (const key of SETTINGS_FIELDS) {
      const val = String(draft[key] ?? "");
      const err = validate(key, val);
      if (err) errors[key] = err;
    }
    setValidationErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const updated = await updateSettings({ ...draft, PROVIDERS: providers });
      setSettings(updated);
      setDraft(editableSettings(updated));
      setProviders(updated.PROVIDERS ?? []);
      setSuccess(true);
    } catch {
      setError("Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  function updateProvider(index: number, update: Partial<ProviderEntry>) {
    setProviders((current) =>
      current.map((provider, providerIndex) =>
        providerIndex === index ? { ...provider, ...update } : provider,
      ),
    );
    setSuccess(false);
  }

  function addProvider() {
    const suffix = providers.length + 1;
    setProviders((current) => [
      ...current,
      {
        id: `provider-${suffix}`,
        displayName: `Provider ${suffix}`,
        protocol: "openai",
        baseUrl: "https://api.example.com/v1",
        apiKeyEnv: "PROVIDER_API_KEY",
        enabled: true,
        priority: suffix - 1,
      },
    ]);
    setProviderKeys((current) => [...current, `provider-${nextProviderKey.current++}`]);
  }

  async function testProvider(provider: ProviderEntry) {
    setProviderStatus((current) => ({ ...current, [provider.id]: "Testing..." }));
    try {
      const result = await testProviderConnection(provider);
      setProviderStatus((current) => ({
        ...current,
        [provider.id]: `Connected (${result.modelCount} models)`,
      }));
    } catch {
      setProviderStatus((current) => ({ ...current, [provider.id]: "Connection failed" }));
    }
  }

  if (!settings) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">Loading...</div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label
          htmlFor="settings-ROOT"
          className="uppercase tracking-wider text-xs text-muted-foreground"
        >
          {FIELD_LABELS.ROOT}
        </Label>
        <Input id="settings-ROOT" type="text" value={settings.ROOT} disabled />
        <span className="text-xs text-muted-foreground">
          Set ROOT in the server environment to change the workspace boundary.
        </span>
      </div>
      {SETTINGS_FIELDS.map((field) => (
        <div key={field} className="flex flex-col gap-1.5">
          <Label
            htmlFor={`settings-${field}`}
            className="uppercase tracking-wider text-xs text-muted-foreground"
          >
            {FIELD_LABELS[field]}
          </Label>
          {field === "DEFAULT_MODEL" ? (
            <Select
              value={String(draft[field] ?? "")}
              onValueChange={(v) => handleChange(field, v)}
              disabled={saving || modelsLoading}
            >
              <SelectTrigger id={`settings-${field}`} className="w-full">
                <SelectValue placeholder="Select a model" />
              </SelectTrigger>
              <SelectContent>
                {modelsLoading && modelOptions.length === 0 ? (
                  <SelectItem value="__loading" disabled>
                    Loading models...
                  </SelectItem>
                ) : (
                  modelOptions.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      {model.id} ({model.owned_by})
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          ) : (
            <Input
              id={`settings-${field}`}
              type={NUMBER_FIELDS.includes(field) ? "number" : "text"}
              value={String(draft[field] ?? "")}
              onChange={(e) => handleChange(field, e.target.value)}
              disabled={saving}
              className={
                validationErrors[field] ? "border-destructive focus-visible:ring-destructive" : ""
              }
            />
          )}
          {validationErrors[field] && (
            <span className="text-xs text-destructive">{validationErrors[field]}</span>
          )}
          {field === "DEFAULT_MODEL" && modelsError && (
            <div
              role="alert"
              className="flex items-center justify-between gap-3 rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              <span>{modelsError}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void loadModels()}
                disabled={modelsLoading}
                aria-label="Retry loading models"
              >
                Retry
              </Button>
            </div>
          )}
        </div>
      ))}

      <section className="mt-4 flex flex-col gap-3" aria-labelledby="provider-settings-heading">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 id="provider-settings-heading" className="text-sm font-semibold">
              Model Providers
            </h2>
            <p className="text-xs text-muted-foreground">
              Ordered by priority; lower values are attempted first.
            </p>
          </div>
          <Button type="button" variant="outline" onClick={addProvider} disabled={saving}>
            Add Provider
          </Button>
        </div>
        {providers.length === 0 && (
          <p className="rounded border p-3 text-sm text-muted-foreground">
            No provider registry configured. The legacy endpoint remains active.
          </p>
        )}
        {providers.map((provider, index) => (
          <div key={providerKeys[index]} className="grid gap-3 rounded border p-3 md:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`provider-${index}-id`}>Provider ID</Label>
              <Input
                id={`provider-${index}-id`}
                value={provider.id}
                onChange={(event) => updateProvider(index, { id: event.target.value })}
                disabled={saving}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`provider-${index}-name`}>Display Name</Label>
              <Input
                id={`provider-${index}-name`}
                value={provider.displayName}
                onChange={(event) => updateProvider(index, { displayName: event.target.value })}
                disabled={saving}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`provider-${index}-protocol`}>Protocol</Label>
              <select
                id={`provider-${index}-protocol`}
                className="h-10 rounded-md border bg-background px-3 text-sm"
                value={provider.protocol}
                onChange={(event) => {
                  const protocol = event.target.value;
                  if (protocol === "openai" || protocol === "anthropic") {
                    updateProvider(index, { protocol });
                  }
                }}
                disabled={saving}
              >
                <option value="openai">OpenAI compatible</option>
                <option value="anthropic">Anthropic compatible</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`provider-${index}-priority`}>Priority</Label>
              <Input
                id={`provider-${index}-priority`}
                type="number"
                value={provider.priority}
                onChange={(event) =>
                  updateProvider(index, { priority: Number(event.target.value) })
                }
                disabled={saving}
              />
            </div>
            <div className="flex flex-col gap-1 md:col-span-2">
              <Label htmlFor={`provider-${index}-url`}>Base URL</Label>
              <Input
                id={`provider-${index}-url`}
                value={provider.baseUrl}
                onChange={(event) => updateProvider(index, { baseUrl: event.target.value })}
                disabled={saving}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`provider-${index}-key`}>API Key Environment Variable</Label>
              <Input
                id={`provider-${index}-key`}
                value={provider.apiKeyEnv}
                onChange={(event) => updateProvider(index, { apiKeyEnv: event.target.value })}
                disabled={saving}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`provider-${index}-models`}>Supported Models</Label>
              <Input
                id={`provider-${index}-models`}
                value={provider.supportedModels?.join(", ") ?? ""}
                placeholder="gpt-4*, custom-model"
                onChange={(event) =>
                  updateProvider(index, {
                    supportedModels: event.target.value
                      .split(",")
                      .map((value) => value.trim())
                      .filter(Boolean),
                  })
                }
                disabled={saving}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={provider.enabled}
                onChange={(event) => updateProvider(index, { enabled: event.target.checked })}
                disabled={saving}
              />
              Enabled
            </label>
            <div className="flex items-center justify-end gap-2">
              {providerStatus[provider.id] && (
                <span role="status" className="text-xs text-muted-foreground">
                  {providerStatus[provider.id]}
                </span>
              )}
              <Button
                type="button"
                variant="outline"
                onClick={() => void testProvider(provider)}
                disabled={saving}
              >
                Test Connection
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  setProviders((current) => current.filter((_, i) => i !== index));
                  setProviderKeys((current) => current.filter((_, i) => i !== index));
                }}
                disabled={saving}
              >
                Remove
              </Button>
            </div>
          </div>
        ))}
      </section>

      {error && (
        <div className="rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-600 dark:text-green-400">
          Settings saved successfully
        </div>
      )}

      <Button
        onClick={handleSave}
        disabled={saving || Object.keys(validationErrors).length > 0}
        className="mt-2 w-fit"
      >
        {saving ? "Saving..." : "Save Settings"}
      </Button>
    </div>
  );
}
