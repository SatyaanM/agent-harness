'use client';

import { useState } from 'react';
import { useTTSStore } from '@/stores/tts-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';

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
  const [apiKey, setApiKey] = useState('');
  const [apiKeySet, setApiKeySet] = useState(false);

  const handlePreview = async () => {
    setIsPreviewPlaying(true);
    try {
      await play(previewText);
    } catch (error) {
      console.error('Preview failed:', error);
      alert('Preview failed. Make sure GEMINI_API_KEY is configured.');
    } finally {
      setIsPreviewPlaying(false);
    }
  };

  const handleSaveApiKey = () => {
    alert(
      'API key saved. In production, this would be saved to .env on the server.'
    );
    setApiKeySet(true);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="space-y-2">
            <Label htmlFor="gemini-key">Gemini API Key</Label>
            <div className="flex gap-2">
              <Input
                id="gemini-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter your Gemini API key"
                className="flex-1"
              />
              <Button onClick={handleSaveApiKey} disabled={apiKeySet}>
                {apiKeySet ? 'Saved' : 'Save'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Get your API key from{' '}
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline dark:text-blue-400"
              >
                Google AI Studio
              </a>
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="voice">Voice</Label>
            <Select value={voice} onValueChange={setVoice}>
              <SelectTrigger id="voice" className="w-full">
                <SelectValue placeholder="Select a voice" />
              </SelectTrigger>
              <SelectContent>
                {availableVoices.map((v) => (
                  <SelectItem key={v.name} value={v.name}>
                    {v.name} ({v.style})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="persona">Voice Persona</Label>
            <Textarea
              id="persona"
              value={persona}
              onChange={(e) => setPersona(e.target.value)}
              placeholder="You are a warm, mature British narrator. Speak naturally and conversationally."
              rows={4}
            />
            <p className="text-xs text-muted-foreground">
              Optional instructions to set the overall tone and style of the
              voice. Tags in the text will override locally.
            </p>
          </div>

          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label htmlFor="emotive-tags">Enable emotive audio tags</Label>
              <p className="text-xs text-muted-foreground">
                Tags like [excitedly], [sighs], [whispers] add delivery nuance
                to the spoken output.
              </p>
            </div>
            <Switch
              id="emotive-tags"
              checked={emotiveTags}
              onCheckedChange={setEmotiveTags}
            />
          </div>

          {emotiveTags && (
            <div className="space-y-4 pl-2 border-l-2 border-border pl-4">
              <div className="space-y-2">
                <Label>Tag Style</Label>
                <Select
                  value={tagStyle}
                  onValueChange={(v) =>
                    setTagStyle(
                      v as 'conservative' | 'balanced' | 'expressive'
                    )
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select tag style" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="conservative">
                      Conservative — Only essential tags (serious, sighs)
                    </SelectItem>
                    <SelectItem value="balanced">
                      Balanced — Moderate use of tags
                    </SelectItem>
                    <SelectItem value="expressive">
                      Expressive — Frequent creative tags
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="custom-tags">Custom Tag Instructions</Label>
                <Textarea
                  id="custom-tags"
                  value={customTagInstructions}
                  onChange={(e) => setCustomTagInstructions(e.target.value)}
                  placeholder="Additional instructions for when to use tags..."
                  rows={2}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 p-4">
          <Label htmlFor="preview">Preview</Label>
          <div className="flex gap-2">
            <Input
              id="preview"
              type="text"
              value={previewText}
              onChange={(e) => setPreviewText(e.target.value)}
              placeholder="Enter text to preview"
              className="flex-1"
            />
            <Button
              onClick={handlePreview}
              disabled={isPreviewPlaying}
              variant="secondary"
            >
              {isPreviewPlaying ? 'Playing...' : 'Test Voice'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
