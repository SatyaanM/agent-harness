'use client';

import { useState, useEffect } from 'react';
import { fetchSettings, updateSettings, fetchModels, type HarnessSettings, type ModelInfo } from '@/lib/api';

const FIELD_LABELS: Record<keyof HarnessSettings, string> = {
  ROOT: 'Root Directory',
  INBOX_ROOT: 'Inbox Directory',
  SESSIONS_DIR: 'Sessions Directory',
  AGENTS_DIR: 'Agents Directory',
  PROVIDER_ENDPOINT: 'Provider Endpoint',
  API_KEY_ENV: 'API Key Environment Variable',
  DEFAULT_MODEL: 'Default Model',
  MAX_CONCURRENT_AGENTS: 'Max Concurrent Agents',
};

const PATH_FIELDS: (keyof HarnessSettings)[] = ['ROOT', 'INBOX_ROOT', 'SESSIONS_DIR', 'AGENTS_DIR'];
const URL_FIELDS: (keyof HarnessSettings)[] = ['PROVIDER_ENDPOINT'];
const NUMBER_FIELDS: (keyof HarnessSettings)[] = ['MAX_CONCURRENT_AGENTS'];

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
      .catch(() => setError('Failed to load settings'));

    // Fetch available models from the server
    fetchModels()
      .then((data) => {
        setAvailableModels(data.data || []);
      })
      .catch((err) => {
        console.error('Failed to fetch models:', err);
      })
      .finally(() => {
        setModelsLoading(false);
      });
  }, []);

  function validate(field: keyof HarnessSettings, value: string): string {
    if (!value.trim()) return 'Required';
    if (PATH_FIELDS.includes(field) && !value.startsWith('/') && !value.match(/^[A-Z]:\\/i)) {
      return 'Must be an absolute path';
    }
    if (URL_FIELDS.includes(field)) {
      try { new URL(value); } catch { return 'Must be a valid URL'; }
    }
    if (NUMBER_FIELDS.includes(field) && (isNaN(Number(value)) || Number(value) < 1)) {
      return 'Must be a positive number';
    }
    return '';
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
    for (const key of Object.keys(FIELD_LABELS) as (keyof HarnessSettings)[]) {
      const val = String(draft[key] ?? '');
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
      setError('Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  if (!settings) {
    return <div className="flex items-center justify-center h-64 text-zinc-400">Loading...</div>;
  }

  return (
    <div className="flex flex-col gap-4">
      {(Object.keys(FIELD_LABELS) as (keyof HarnessSettings)[]).map((field) => (
        <div key={field} className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
            {FIELD_LABELS[field]}
          </label>
          {field === 'DEFAULT_MODEL' ? (
            <select
              value={String(draft[field] ?? '')}
              onChange={(e) => handleChange(field, e.target.value)}
              disabled={saving || modelsLoading}
              className={`rounded border px-3 py-2 text-sm bg-zinc-900 text-zinc-200 transition-colors focus:outline-none focus:ring-1 ${
                validationErrors[field]
                  ? 'border-red-500 focus:ring-red-500'
                  : 'border-zinc-700 focus:ring-blue-500'
              } disabled:opacity-50`}
            >
              {modelsLoading ? (
                <option value="">Loading models...</option>
              ) : (
                availableModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.id} ({model.owned_by})
                  </option>
                ))
              )}
            </select>
          ) : (
            <input
              type={NUMBER_FIELDS.includes(field) ? 'number' : 'text'}
              value={String(draft[field] ?? '')}
              onChange={(e) => handleChange(field, e.target.value)}
              disabled={saving}
              className={`rounded border px-3 py-2 text-sm bg-zinc-900 text-zinc-200 placeholder-zinc-600 transition-colors focus:outline-none focus:ring-1 ${
                validationErrors[field]
                  ? 'border-red-500 focus:ring-red-500'
                  : 'border-zinc-700 focus:ring-blue-500'
              } disabled:opacity-50`}
            />
          )}
          {validationErrors[field] && (
            <span className="text-xs text-red-400">{validationErrors[field]}</span>
          )}
        </div>
      ))}

      {error && (
        <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-400">
          Settings saved successfully
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={saving || Object.keys(validationErrors).length > 0}
        className="mt-2 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {saving ? 'Saving...' : 'Save Settings'}
      </button>
    </div>
  );
}
