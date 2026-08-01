import { create } from 'zustand';

interface ChatInputState {
  pendingPrefill: string | null;
  prefill: (text: string) => void;
  consumePrefill: () => void;
}

export const useChatInputStore = create<ChatInputState>((set) => ({
  pendingPrefill: null,
  prefill: (text) => set({ pendingPrefill: text }),
  consumePrefill: () => set({ pendingPrefill: null }),
}));
