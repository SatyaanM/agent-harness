import { parseJsonBoundary } from "@agent-harness/core/contracts";
import { z } from "zod";
import { create } from "zustand";
import type { PlaybackState } from "@/lib/tts-player";
import { createTTSPlayer } from "@/lib/tts-player";

export interface TTSVoice {
  name: string;
  style: string;
}

interface TTSStore {
  enabled: boolean;
  voice: string;
  persona: string;
  emotiveTags: boolean;
  tagStyle: "conservative" | "balanced" | "expressive";
  customTagInstructions: string;
  playbackState: PlaybackState;
  availableVoices: TTSVoice[];

  toggleEnabled: () => void;
  setVoice: (voice: string) => void;
  setPersona: (persona: string) => void;
  setEmotiveTags: (enabled: boolean) => void;
  setTagStyle: (style: "conservative" | "balanced" | "expressive") => void;
  setCustomTagInstructions: (instructions: string) => void;
  play: (text: string) => Promise<void>;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  loadSettings: () => void;
  saveSettings: () => void;
}

const player = createTTSPlayer();
const TTSSettingsSchema = z
  .object({
    enabled: z.boolean(),
    voice: z.string().min(1).max(128),
    persona: z.string().max(10_000),
    emotiveTags: z.boolean(),
    tagStyle: z.enum(["conservative", "balanced", "expressive"]),
    customTagInstructions: z.string().max(10_000),
  })
  .partial()
  .strict();

// Available voices from Gemini
const DEFAULT_VOICES: TTSVoice[] = [
  { name: "Zephyr", style: "Bright" },
  { name: "Puck", style: "Upbeat" },
  { name: "Charon", style: "Informative" },
  { name: "Kore", style: "Firm" },
  { name: "Fenrir", style: "Excitable" },
  { name: "Leda", style: "Youthful" },
  { name: "Orus", style: "Firm" },
  { name: "Aoede", style: "Breezy" },
  { name: "Callirrhoe", style: "Easy-going" },
  { name: "Autonoe", style: "Bright" },
  { name: "Enceladus", style: "Breathy" },
  { name: "Iapetus", style: "Clear" },
  { name: "Umbriel", style: "Easy-going" },
  { name: "Algieba", style: "Smooth" },
  { name: "Despina", style: "Smooth" },
  { name: "Erinome", style: "Clear" },
  { name: "Algenib", style: "Gravelly" },
  { name: "Rasalgethi", style: "Informative" },
  { name: "Laomedeia", style: "Upbeat" },
  { name: "Achernar", style: "Soft" },
  { name: "Alnilam", style: "Firm" },
  { name: "Schedar", style: "Even" },
  { name: "Gacrux", style: "Mature" },
  { name: "Pulcherrima", style: "Forward" },
  { name: "Achird", style: "Friendly" },
  { name: "Zubenelgenubi", style: "Casual" },
  { name: "Vindemiatrix", style: "Gentle" },
  { name: "Sadachbia", style: "Lively" },
  { name: "Sadaltager", style: "Knowledgeable" },
  { name: "Sulafat", style: "Warm" },
];

// Listen for state changes from player
player.onStateChange((state) => {
  useTTSStore.setState({ playbackState: state });
});

function loadSettingsFromStorage(): z.infer<typeof TTSSettingsSchema> {
  if (typeof window === "undefined") return {};
  try {
    const stored = localStorage.getItem("tts-settings");
    return stored ? parseJsonBoundary(TTSSettingsSchema, stored, "TTS local settings") : {};
  } catch {
    return {};
  }
}

function saveSettingsToStorage(settings: {
  enabled: boolean;
  voice: string;
  persona: string;
  emotiveTags: boolean;
  tagStyle: string;
  customTagInstructions: string;
}) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem("tts-settings", JSON.stringify(settings));
  } catch {
    // Ignore storage errors
  }
}

export const useTTSStore = create<TTSStore>((set, get) => {
  const saved = loadSettingsFromStorage();

  return {
    enabled: saved.enabled ?? false,
    voice: saved.voice ?? "Gacrux",
    persona: saved.persona ?? "",
    emotiveTags: saved.emotiveTags ?? true,
    tagStyle: saved.tagStyle ?? "balanced",
    customTagInstructions: saved.customTagInstructions ?? "",
    playbackState: "idle",
    availableVoices: DEFAULT_VOICES,

    toggleEnabled: () => {
      set((state) => {
        const newEnabled = !state.enabled;
        saveSettingsToStorage({ ...state, enabled: newEnabled });
        return { enabled: newEnabled };
      });
    },

    setVoice: (voice) => {
      set((state) => {
        saveSettingsToStorage({ ...state, voice });
        return { voice };
      });
    },

    setPersona: (persona) => {
      set((state) => {
        saveSettingsToStorage({ ...state, persona });
        return { persona };
      });
    },

    setEmotiveTags: (emotiveTags) => {
      set((state) => {
        saveSettingsToStorage({ ...state, emotiveTags });
        return { emotiveTags };
      });
    },

    setTagStyle: (tagStyle) => {
      set((state) => {
        saveSettingsToStorage({ ...state, tagStyle });
        return { tagStyle };
      });
    },

    setCustomTagInstructions: (customTagInstructions) => {
      set((state) => {
        saveSettingsToStorage({ ...state, customTagInstructions });
        return { customTagInstructions };
      });
    },

    play: async (text) => {
      const { voice, persona, emotiveTags, tagStyle, customTagInstructions } = get();
      await player.play(text, {
        voice,
        persona,
        emotiveTags,
        tagStyle,
        customTagInstructions,
      });
    },

    stop: () => player.stop(),
    pause: () => player.pause(),
    resume: () => player.resume(),

    loadSettings: () => {
      const saved = loadSettingsFromStorage();
      set({
        enabled: saved.enabled ?? false,
        voice: saved.voice ?? "Gacrux",
        persona: saved.persona ?? "",
        emotiveTags: saved.emotiveTags ?? true,
        tagStyle: saved.tagStyle ?? "balanced",
        customTagInstructions: saved.customTagInstructions ?? "",
      });
    },

    saveSettings: () => {
      const state = get();
      saveSettingsToStorage({
        enabled: state.enabled,
        voice: state.voice,
        persona: state.persona,
        emotiveTags: state.emotiveTags,
        tagStyle: state.tagStyle,
        customTagInstructions: state.customTagInstructions,
      });
    },
  };
});
