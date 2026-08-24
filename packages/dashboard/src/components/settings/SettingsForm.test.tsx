import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchModels, fetchSettings, testProviderConnection, updateSettings } from "@/lib/api";
import { SettingsForm } from "./SettingsForm";

vi.mock("@/lib/api", () => ({
  fetchModels: vi.fn(),
  fetchSettings: vi.fn(),
  testProviderConnection: vi.fn(),
  updateSettings: vi.fn(),
}));

const SETTINGS = {
  ROOT: "E:\\Projects\\agent-harness",
  INBOX_ROOT: "E:\\Projects\\agent-harness\\inbox",
  SESSIONS_DIR: "E:\\Projects\\agent-harness\\sessions",
  AGENTS_DIR: "E:\\Projects\\agent-harness\\agents",
  PROVIDER_ENDPOINT: "http://127.0.0.1:4010/v1",
  API_KEY_ENV: "LOCAL_SMOKE_API_KEY",
  DEFAULT_MODEL: "configured-model",
  MAX_CONCURRENT_AGENTS: 10,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(fetchSettings).mockResolvedValue(SETTINGS);
  vi.mocked(fetchModels).mockRejectedValue(new Error("provider unavailable"));
  vi.mocked(updateSettings).mockResolvedValue(SETTINGS);
  vi.mocked(testProviderConnection).mockResolvedValue({ connected: true, modelCount: 2 });
});

afterEach(cleanup);

describe("SettingsForm model loading", () => {
  it("keeps the configured model visible and reports a retryable loading error", async () => {
    const user = userEvent.setup();
    render(<SettingsForm />);

    expect(await screen.findByRole("combobox", { name: "Default Model" })).toHaveTextContent(
      "configured-model",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Unable to load provider models");
    expect(screen.getByRole("button", { name: "Retry loading models" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save Settings" }));
    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({ DEFAULT_MODEL: "configured-model" }),
      ),
    );
  });

  it("retries model discovery and keeps the configured value when saving", async () => {
    vi.mocked(fetchModels)
      .mockReset()
      .mockRejectedValueOnce(new Error("provider unavailable"))
      .mockResolvedValue({
        object: "list",
        data: [
          {
            id: "configured-model",
            object: "model",
            created: 1,
            owned_by: "test-provider",
          },
        ],
      });
    const user = userEvent.setup();
    render(<SettingsForm />);

    await user.click(await screen.findByRole("button", { name: "Retry loading models" }));
    await waitFor(() => expect(fetchModels).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByRole("combobox", { name: "Default Model" })).toHaveTextContent(
      "configured-model",
    );

    await user.click(screen.getByRole("button", { name: "Save Settings" }));
    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({ DEFAULT_MODEL: "configured-model" }),
      ),
    );
  });

  it("adds, edits, tests, and persists provider entries", async () => {
    vi.mocked(updateSettings).mockImplementation(async (update) => ({ ...SETTINGS, ...update }));
    const user = userEvent.setup();
    render(<SettingsForm />);
    await screen.findByRole("button", { name: "Add Provider" });

    await user.click(screen.getByRole("button", { name: "Add Provider" }));
    await user.clear(screen.getByLabelText("Provider ID"));
    await user.type(screen.getByLabelText("Provider ID"), "custom-provider");
    await user.click(screen.getByRole("button", { name: "Save Settings" }));

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          PROVIDERS: [expect.objectContaining({ id: "custom-provider", protocol: "openai" })],
        }),
      ),
    );

    await user.click(screen.getByRole("button", { name: "Test Connection" }));
    await waitFor(() =>
      expect(testProviderConnection).toHaveBeenCalledWith(
        expect.objectContaining({ id: "custom-provider" }),
      ),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Connected (2 models)");

    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.queryByLabelText("Provider ID")).not.toBeInTheDocument();
  });
});
