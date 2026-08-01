'use client';

import { Volume2, VolumeX, Pause, Play, Square } from 'lucide-react';
import { useTTSStore } from '@/stores/tts-store';
import { Button } from '@/components/ui/button';

export function TTSButton() {
  const { enabled, playbackState, toggleEnabled, stop, pause, resume } =
    useTTSStore();

  const isPlaying = playbackState === 'playing';
  const isPaused = playbackState === 'paused';

  return (
    <div className="flex items-center gap-1">
      <Button
        variant={enabled ? 'default' : 'secondary'}
        size="icon"
        onClick={toggleEnabled}
        title={enabled ? 'Voice output enabled' : 'Voice output disabled'}
        aria-label="Toggle voice output"
        className={enabled ? 'bg-green-600 hover:bg-green-700' : ''}
      >
        {enabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
      </Button>

      {enabled && (isPlaying || isPaused) && (
        <div className="flex items-center gap-1">
          {isPlaying ? (
            <Button variant="outline" size="icon" onClick={pause} title="Pause">
              <Pause className="h-3 w-3" />
            </Button>
          ) : (
            <Button variant="outline" size="icon" onClick={resume} title="Resume">
              <Play className="h-3 w-3" />
            </Button>
          )}
          <Button variant="destructive" size="icon" onClick={stop} title="Stop">
            <Square className="h-3 w-3" />
          </Button>
        </div>
      )}

      {enabled && isPlaying && (
        <span className="ml-1 text-xs text-green-600 animate-pulse dark:text-green-400">
          Playing...
        </span>
      )}
    </div>
  );
}
