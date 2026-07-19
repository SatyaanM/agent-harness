"use client";

import { useTTSStore } from "@/stores/tts-store";

export function TTSButton() {
  const { enabled, playbackState, toggleEnabled, stop, pause, resume } =
    useTTSStore();

  const isPlaying = playbackState === "playing";
  const isPaused = playbackState === "paused";

  return (
    <div className="flex items-center gap-1">
      {/* Main toggle button */}
      <button
        onClick={toggleEnabled}
        className={`rounded-lg px-3 py-2 text-sm transition-colors ${
          enabled
            ? "bg-green-600 text-white hover:bg-green-700"
            : "bg-gray-200 text-gray-600 hover:bg-gray-300"
        }`}
        title={enabled ? "Voice output enabled" : "Voice output disabled"}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {enabled ? (
            <>
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            </>
          ) : (
            <>
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <line x1="23" y1="9" x2="17" y2="15" />
              <line x1="17" y1="9" x2="23" y2="15" />
            </>
          )}
        </svg>
      </button>

      {/* Playback controls (only when enabled and playing/paused) */}
      {enabled && (isPlaying || isPaused) && (
        <div className="flex items-center gap-1">
          {isPlaying ? (
            <button
              onClick={pause}
              className="rounded-lg bg-yellow-500 px-2 py-1.5 text-xs text-white hover:bg-yellow-600"
              title="Pause"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-3 w-3"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </svg>
            </button>
          ) : (
            <button
              onClick={resume}
              className="rounded-lg bg-green-500 px-2 py-1.5 text-xs text-white hover:bg-green-600"
              title="Resume"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-3 w-3"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            </button>
          )}
          <button
            onClick={stop}
            className="rounded-lg bg-red-500 px-2 py-1.5 text-xs text-white hover:bg-red-600"
            title="Stop"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-3 w-3"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <rect x="4" y="4" width="16" height="16" rx="2" />
            </svg>
          </button>
        </div>
      )}

      {/* Playing indicator */}
      {enabled && isPlaying && (
        <span className="ml-1 text-xs text-green-600 animate-pulse">
          Playing...
        </span>
      )}
    </div>
  );
}
