"use client";

import { useState } from "react";
import { useTTSStore } from "@/stores/tts-store";

export function VoiceSettings() {
  const {
    voice,
    persona,
    emotiveTags,
    tagStyle,
    customTagInstructions,
    availableVoices,
    setVoice,
    setPersona,
    setEmotiveTags,
    setTagStyle,
    setCustomTagInstructions,
    play,
  } = useTTSStore();

  const [previewText, setPreviewText] = useState(
    "Hey there! I've finished the refactoring. All tests are passing, though there were a few hiccups along the way."
  );
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [apiKeySet, setApiKeySet] = useState(false);

  const handlePreview = async () => {
    setIsPreviewPlaying(true);
    try {
      await play(previewText);
    } catch (error) {
      console.error("Preview failed:", error);
      alert("Preview failed. Make sure GEMINI_API_KEY is configured.");
    } finally {
      setIsPreviewPlaying(false);
    }
  };

  const handleSaveApiKey = () => {
    // In a real app, this would save to the server
    // For now, we just show a message
    alert(
      "API key saved. In production, this would be saved to .env on the server."
    );
    setApiKeySet(true);
  };

  return (
    <div className="space-y-6">
      {/* API Key */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Gemini API Key
        </label>
        <div className="flex gap-2">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Enter your Gemini API key"
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
          <button
            onClick={handleSaveApiKey}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
          >
            Save
          </button>
        </div>
        <p className="mt-1 text-xs text-gray-500">
          Get your API key from{" "}
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline"
          >
            Google AI Studio
          </a>
        </p>
      </div>

      {/* Voice Selection */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Voice
        </label>
        <select
          value={voice}
          onChange={(e) => setVoice(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        >
          {availableVoices.map((v) => (
            <option key={v.name} value={v.name}>
              {v.name} ({v.style})
            </option>
          ))}
        </select>
      </div>

      {/* Voice Persona */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Voice Persona{" "}
          <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <textarea
          value={persona}
          onChange={(e) => setPersona(e.target.value)}
          placeholder="You are a warm, mature British narrator. Speak naturally and conversationally."
          rows={4}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        />
        <p className="mt-1 text-xs text-gray-500">
          Optional instructions to set the overall tone and style of the voice.
          Tags in the text will override locally.
        </p>
      </div>

      {/* Emotive Tags */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <input
            type="checkbox"
            id="emotive-tags"
            checked={emotiveTags}
            onChange={(e) => setEmotiveTags(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <label htmlFor="emotive-tags" className="text-sm font-medium text-gray-700">
            Enable emotive audio tags
          </label>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          Tags like [excitedly], [sighs], [whispers] add delivery nuance to the
          spoken output.
        </p>

        {emotiveTags && (
          <div className="ml-6 space-y-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">
                Tag Style
              </label>
              <select
                value={tagStyle}
                onChange={(e) =>
                  setTagStyle(
                    e.target.value as "conservative" | "balanced" | "expressive"
                  )
                }
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              >
                <option value="conservative">
                  Conservative — Only essential tags (serious, sighs)
                </option>
                <option value="balanced">
                  Balanced — Moderate use of tags
                </option>
                <option value="expressive">
                  Expressive — Frequent creative tags
                </option>
              </select>
            </div>

            <div>
              <label className="block text-sm text-gray-600 mb-1">
                Custom Tag Instructions
              </label>
              <textarea
                value={customTagInstructions}
                onChange={(e) => setCustomTagInstructions(e.target.value)}
                placeholder="Additional instructions for when to use tags..."
                rows={2}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>
        )}
      </div>

      {/* Preview */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Preview
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={previewText}
            onChange={(e) => setPreviewText(e.target.value)}
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            placeholder="Enter text to preview"
          />
          <button
            onClick={handlePreview}
            disabled={isPreviewPlaying}
            className="rounded-lg bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-700 disabled:bg-gray-300"
          >
            {isPreviewPlaying ? "Playing..." : "Test Voice"}
          </button>
        </div>
      </div>
    </div>
  );
}
