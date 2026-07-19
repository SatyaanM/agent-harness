export interface TTSConfig {
  provider: "gemini";
  model: string;
  voice: string;
  persona: string;
  emotiveTags: boolean;
  tagStyle: "conservative" | "balanced" | "expressive";
  customTagInstructions: string;
  apiKey: string;
}

export interface ParaphraseConfig {
  model: string;
  maxSentences: number;
  emotiveTags: boolean;
  tagStyle: "conservative" | "balanced" | "expressive";
  customTagInstructions: string;
}

export interface ChunkerConfig {
  minChars: number;
  minSentences: number;
}

export interface AudioChunk {
  data: Int16Array;
  sampleRate: number;
  channels: number;
}

export interface TTSProvider {
  synthesize(text: string, config: TTSConfig): Promise<AsyncIterable<AudioChunk>>;
}

export interface ParaphraseResult {
  text: string;
  tags: string[];
}

export const GEMINI_VOICES = [
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
] as const;

export type GeminiVoiceName = (typeof GEMINI_VOICES)[number]["name"];

export const TAG_INDICATORS: Record<string, string> = {
  excitedly: "✨",
  excited: "✨",
  amazed: "😲",
  sighs: "😮‍💨",
  laughs: "😄",
  giggles: "😊",
  whispers: "🤫",
  serious: "⚠️",
  gasp: "😮",
  crying: "😢",
  curious: "🤔",
  panicked: "😰",
  sarcastic: "😏",
  shouting: "📢",
  tired: "😴",
  trembling: "🫨",
  mischievously: "😈",
};
