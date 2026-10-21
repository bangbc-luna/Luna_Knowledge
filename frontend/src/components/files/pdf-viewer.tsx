"use client";

import { CircleAlert, Minus, Plus } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { Button, IconButton } from "../ui/button";

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
/** Lề hai bên trang trong khung (p-4 mỗi bên). */
const GUTTER = 32;
const MAX_FIT_WIDTH = 960;

type PdfJs = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<PdfJs> | null = null;

/** Nạp pdf.js một lần, chỉ ở trình duyệt (thư viện dùng API DOM lúc import). */
function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= import("pdfjs-dist").then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    return pdfjs;
  });
  return pdfjsPromise;
}

function PdfPage({
  doc,
  pageNo,
  width,
  ratio,
}: {
  doc: PDFDocumentProxy;
  pageNo: number;
  width: number;
  /** cao / rộng, lấy từ trang 1 để giữ chỗ trước khi vẽ. */
  ratio: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false);
  const [pageRatio, setPageRatio] = useState(ratio);

  // Chỉ vẽ trang ở gần khung nhìn (tệp hàng trăm trang không vẽ hết một lúc).
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => e && setNear(e.isIntersecting), { rootMargin: "800px 0px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!near || !canvas.current || width <= 0) return;
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    void doc.getPage(pageNo).then((page) => {
      if (cancelled || !canvas.current) return;
      const base = page.getViewport({ scale: 1 });
      setPageRatio(base.height / base.width);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: (width / base.width) * dpr });
      const c = canvas.current;
      c.width = Math.floor(viewport.width);
      c.height = Math.floor(viewport.height);
      task = page.render({ canvas: c, viewport });
      task.promise.catch(() => undefined);
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, pageNo, width, near]);

  return (
    <div
      ref={box}
      data-page={pageNo}
      className="shrink-0 overflow-hidden rounded-sm border border-border-strong bg-white"
      style={{ width, height: Math.round(width * pageRatio) }}
      aria-label={`Trang ${pageNo}`}
      role="img"
    >
      <canvas ref={canvas} className="block size-full" />
    </div>
  );
}

/**
 * Trình xem PDF bằng pdf.js: mọi trình duyệt (kể cả Safari trên iPad, nơi PDF trong iframe chỉ
 * hiện trang đầu) đều cuộn được hết các trang. Thanh trên: số trang đang xem, thu nhỏ / phóng to.
 */
export function PdfViewer({ url, title, className }: { url: string; title: string; className?: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [ratio, setRatio] = useState(1.414);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [fitWidth, setFitWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [current, setCurrent] = useState(1);

  useEffect(() => {
    let alive = true;
    let task: ReturnType<PdfJs["getDocument"]> | null = null;
    loadPdfJs()
      .then((pdfjs) => {
        task = pdfjs.getDocument({ url });
        if (!alive) void task.destroy();
        return task.promise;
      })
      .then(async (d) => {
        if (!alive) return;
        const first = (await d.getPage(1)).getViewport({ scale: 1 });
        setRatio(first.height / first.width);
        setDoc(d);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      void task?.destroy();
    };
  }, [url, attempt]);

  // Bề rộng "vừa khung" theo khung thật (đổi khi xoay iPad, mở/đóng sidebar).
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const obs = new ResizeObserver(([e]) => e && setFitWidth(Math.min(MAX_FIT_WIDTH, Math.max(0, e.contentRect.width - GUTTER))));
    obs.observe(el);
    return () => obs.disconnect();
  }, [doc]);

  // Trang hiện tại = trang đang nằm ở đường giữa khung (trang cao hơn khung vẫn tính đúng).
  // Gộp theo khung hình và tìm nhị phân theo offsetTop: tệp vài trăm trang cuộn vẫn mượt trên iPad.
  const frame = useRef(0);
  const onScroll = () => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const el = scroller.current;
      const list = el?.querySelector("[data-page]")?.parentElement;
      if (!el || !list) return;
      const pages = list.children as HTMLCollectionOf<HTMLElement>;
      const mid = el.scrollTop + el.clientHeight / 2;
      let lo = 0;
      let hi = pages.length - 1;
      while (lo < hi) {
        const m = (lo + hi) >> 1;
        const p = pages[m]!;
        if (p.offsetTop + p.offsetHeight < mid) lo = m + 1;
        else hi = m;
      }
      setCurrent(lo + 1);
    });
  };

  if (failed) {
    return (
      <div className={cn("flex flex-col items-center justify-center gap-2 px-6 text-center", className)}>
        <CircleAlert className="size-5 text-err" aria-hidden />
        <p className="text-sm font-medium text-foreground">Không mở được bản xem trước PDF</p>
        <Button
          className="mt-2"
          onClick={() => {
            setFailed(false);
            setAttempt((a) => a + 1);
          }}
        >
          Thử lại
        </Button>
      </div>
    );
  }

  const zi = ZOOMS.indexOf(zoom);
  const width = Math.round(fitWidth * zoom);
  return (
    <div className={cn("flex flex-col", className)}>
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3 sm:px-4">
        <p className="min-w-0 flex-1 truncate text-sm text-muted tabular-nums" aria-live="polite">
          {doc ? `Trang ${current} / ${doc.numPages}` : "Đang mở…"}
        </p>
        <IconButton icon={Minus} label="Thu nhỏ" disabled={!doc || zi <= 0} onClick={() => setZoom(ZOOMS[zi - 1]!)} />
        <button
          type="button"
          onClick={() => setZoom(1)}
          disabled={!doc}
          title="Vừa khung"
          className="inline-flex h-8 min-w-14 cursor-pointer items-center justify-center rounded-lg px-2 text-sm text-foreground tabular-nums outline-hidden hover:bg-foreground/8 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {Math.round(zoom * 100)}%
        </button>
        <IconButton icon={Plus} label="Phóng to" disabled={!doc || zi >= ZOOMS.length - 1} onClick={() => setZoom(ZOOMS[zi + 1]!)} />
      </div>
      <div ref={scroller} onScroll={onScroll} className="relative min-h-0 flex-1 overflow-auto bg-background outline-hidden" aria-label={title}>
        {doc && width > 0 ? (
          <div className="flex w-max min-w-full flex-col items-center gap-4 p-4">
            {Array.from({ length: doc.numPages }, (_, i) => (
              <PdfPage key={i + 1} doc={doc} pageNo={i + 1} width={width} ratio={ratio} />
            ))}
          </div>
        ) : (
          <div className="flex justify-center p-4" aria-busy="true" aria-label="Đang mở PDF">
            <div className="aspect-[1/1.414] w-full max-w-[60rem] animate-pulse rounded-sm bg-foreground/5" />
          </div>
        )}
      </div>
    </div>
  );
}
