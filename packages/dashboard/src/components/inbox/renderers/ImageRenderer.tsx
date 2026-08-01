'use client';

import { useState, useCallback } from 'react';

interface ImageRendererProps {
  content: string;
  item?: { name: string; type: string };
}

export function ImageRenderer({ content, item }: ImageRendererProps) {
  const [error, setError] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const handleClick = useCallback(() => {
    setLightboxOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    setLightboxOpen(false);
  }, []);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
        Failed to load image
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-center h-full p-4 overflow-auto">
        {!loaded && (
          <div className="text-zinc-500 text-sm">Loading...</div>
        )}
        <img
          src={content}
          alt={item?.name ?? ''}
          className={`max-w-full max-h-full object-contain cursor-zoom-in transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0 absolute'}`}
          onClick={handleClick}
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
        />
      </div>

      {lightboxOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 cursor-zoom-out"
          onClick={handleClose}
          onKeyDown={(e) => { if (e.key === 'Escape') handleClose(); }}
          role="dialog"
          aria-modal="true"
          aria-label="Image lightbox"
          tabIndex={-1}
        >
          <img
            src={content}
            alt={item?.name ?? ''}
            className="max-w-[95vw] max-h-[95vh] object-contain"
            draggable={false}
          />
        </div>
      )}
    </>
  );
}
