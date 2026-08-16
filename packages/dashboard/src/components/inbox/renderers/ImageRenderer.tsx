"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface ImageRendererProps {
  content: string;
  item?: { name: string; type: string };
}

export function ImageRenderer({ content, item }: ImageRendererProps) {
  const [error, setError] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const handleClick = useCallback(() => {
    setLightboxOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    setLightboxOpen(false);
    requestAnimationFrame(() => openButtonRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!lightboxOpen) return;
    closeButtonRef.current?.focus();
  }, [lightboxOpen]);

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
        {!loaded && <div className="text-zinc-500 text-sm">Loading...</div>}
        <button
          ref={openButtonRef}
          type="button"
          aria-label={`Open ${item?.name ?? "image"} in lightbox`}
          className="flex max-h-full max-w-full cursor-zoom-in items-center justify-center"
          onClick={handleClick}
        >
          {/* biome-ignore lint/performance/noImgElement: Inbox previews use user-provided data/blob URLs with unknown dimensions. */}
          <img
            src={content}
            alt={item?.name ?? ""}
            className={`max-h-full max-w-full object-contain transition-opacity duration-200 ${loaded ? "opacity-100" : "absolute opacity-0"}`}
            onLoad={() => setLoaded(true)}
            onError={() => setError(true)}
          />
        </button>
      </div>

      {lightboxOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 cursor-zoom-out"
          onClick={(event) => {
            if (event.currentTarget === event.target) handleClose();
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") handleClose();
            if (event.key === "Tab") {
              event.preventDefault();
              closeButtonRef.current?.focus();
            }
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Image lightbox"
        >
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="Close image lightbox"
            onClick={handleClose}
            className="absolute right-4 top-4 rounded-md bg-black/70 p-2 text-white hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <X className="h-5 w-5" />
          </button>
          {/* biome-ignore lint/performance/noImgElement: The lightbox preserves the original user-provided image without Next.js optimization. */}
          <img
            src={content}
            alt={item?.name ?? ""}
            className="max-w-[95vw] max-h-[95vh] object-contain"
            draggable={false}
          />
        </div>
      )}
    </>
  );
}
