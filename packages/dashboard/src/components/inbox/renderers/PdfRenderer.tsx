'use client';

import dynamic from 'next/dynamic';

const PdfRendererInner = dynamic(() => import('./PdfRendererInner'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full text-zinc-400 text-sm">
      Loading PDF viewer...
    </div>
  ),
});

interface PdfRendererProps {
  content: string;
}

export function PdfRenderer({ content }: PdfRendererProps) {
  return <PdfRendererInner src={content} />;
}
