import { useCallback, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

interface PdfRendererInnerProps {
  src: string;
}

export default function PdfRendererInner({ src }: PdfRendererInnerProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const onDocumentLoadSuccess = useCallback(({ numPages: n }: { numPages: number }) => {
    setNumPages(n);
    setPageNumber(1);
    setLoading(false);
    setError(null);
  }, []);

  const onDocumentLoadError = useCallback((err: Error) => {
    setError(err.message || "Failed to load PDF");
    setLoading(false);
  }, []);

  const goToPrevPage = useCallback(() => {
    setPageNumber((p) => Math.max(p - 1, 1));
  }, []);

  const goToNextPage = useCallback(() => {
    setPageNumber((p) => Math.min(p + 1, numPages));
  }, [numPages]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-red-400 text-sm">
        Failed to load PDF: {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {numPages > 1 && (
        <div className="flex items-center justify-center gap-3 px-4 py-2 border-b border-zinc-800">
          <button
            type="button"
            onClick={goToPrevPage}
            disabled={pageNumber <= 1}
            className="px-2 py-1 text-xs text-zinc-300 bg-zinc-800 rounded hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Prev
          </button>
          <span className="text-xs text-zinc-400">
            Page {pageNumber} of {numPages}
          </span>
          <button
            type="button"
            onClick={goToNextPage}
            disabled={pageNumber >= numPages}
            className="px-2 py-1 text-xs text-zinc-300 bg-zinc-800 rounded hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Next
          </button>
        </div>
      )}
      <div className="flex-1 overflow-auto flex justify-center p-4">
        {loading && (
          <div className="flex items-center justify-center text-zinc-400 text-sm">
            Loading PDF...
          </div>
        )}
        <Document
          file={src}
          onLoadSuccess={onDocumentLoadSuccess}
          onLoadError={onDocumentLoadError}
          loading={null}
          className="flex flex-col items-center gap-4"
        >
          <Page pageNumber={pageNumber} width={700} loading={null} className="shadow-lg" />
        </Document>
      </div>
    </div>
  );
}
