"use client";

import { useEffect, useState } from "react";
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
  updateSettings,
} from "@/lib/api";

const FIELD_LABELS: Record<keyof HarnessSettings, string> = {
  ROOT: "Root Directory",
  INBOX_ROOT: "Inbox Directory",
  SESSIONS_DIR: "Sessions Directory",
  AGENTS_DIR: "Agents Directory",
  PROVIDER_ENDPOINT: "Provider Endpoint",
  API_KEY_ENV: "API Key Environment Variable",
  DEFAULT_MODEL: "Default Model",
  MAX_CONCURRENT_AGENTS: "Max Concurrent Agents",
};

const PATH_FIELDS: (keyof HarnessSettings)[] = ["ROOT", "INBOX_ROOT", "SESSIONS_DIR", "AGENTS_DIR"];
const URL_FIELDS: (keyof HarnessSettings)[] = ["PROVIDER_ENDPOINT"];
const NUMBER_FIELDS: (keyof HarnessSettings)[] = ["MAX_CONCURRENT_AGENTS"];
const SETTINGS_FIELDS = [
  "ROOT",
  "INBOX_ROOT",
  "SESSIONS_DIR",
  "AGENTS_DIR",
  "PROVIDER_ENDPOINT",
  "API_KEY_ENV",
  "DEFAULT_MODEL",
  "MAX_CONCURRENT_AGENTS",
] as const satisfies readonly (keyof HarnessSettings)[];

export function SettingsForm() {
  const [settings, setSettings] = useState<HarnessSettings | null>(null);
  const [draft, setDraft] = useState<Partial<HarnessSettings>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);

  useEffect(() => {
    fetchSettings()
      .then((data) => {
        setSettings(data);
        setDraft(data);
      })
      .catch(() => setError("Failed to load settings"));

    fetchModels()
      .then((data) => {
        setAvailableModels(data.data || []);
      })
      .catch((err) => {
        console.error("Failed to fetch models:", err);
      })
      .finally(() => {
        setModelsLoading(false);
      });
  }, []);

  function validate(field: keyof HarnessSettings, value: string): string {
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

  function handleChange(field: keyof HarnessSettings, value: string) {
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
      const updated = await updateSettings(draft);
      setSettings(updated);
      setDraft(updated);
      setSuccess(true);
    } catch {
      setError("Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  if (!settings) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">Loading...</div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
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
                {modelsLoading ? (
                  <SelectItem value="__loading" disabled>
                    Loading models...
                  </SelectItem>
                ) : (
                  availableModels.map((model) => (
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
        </div>
      ))}

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
