"use client";

import { CircleAlert, Clapperboard, Download, LoaderCircle, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { FileDetail, FilePreview } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { Button } from "../ui/button";
import { PdfViewer } from "./pdf-viewer";

/** Chiều cao vùng xem: gần hết màn, trừ thanh trên + đầu trang. */
const VIEW_H = "h-[calc(100dvh-15rem)] min-h-[28rem]";
const TEXT_LIMIT = 200 * 1024;

function Centered({ children }: { children: React.ReactNode }) {
  return <div className={`flex flex-col items-center justify-center gap-2 px-6 py-16 text-center ${VIEW_H}`}>{children}</div>;
}

function TextPreview({ url }: { url: string }) {
  const [text, setText] = useState<{ body: string; cut: boolean } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch(url)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((body) => alive && setText({ body: body.slice(0, TEXT_LIMIT), cut: body.length > TEXT_LIMIT }))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [url]);
  if (failed) return <Centered><p className="text-sm text-muted">Không tải được nội dung. Tải lại trang để thử lại.</p></Centered>;
  if (!text) return <div className={`animate-pulse bg-foreground/3 ${VIEW_H}`} aria-busy="true" aria-label="Đang tải" />;
  return (
    <div className={`overflow-auto ${VIEW_H}`}>
      <pre className="p-5 font-mono text-sm/6 whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]">{text.body}</pre>
      {text.cut ? <p className="border-t border-border px-5 py-3 text-sm text-muted">Chỉ hiện 200 KB đầu. Tải về để xem hết.</p> : null}
    </div>
  );
}

/**
 * Vùng xem trước theo trạng thái tệp: đang tải lên / đang xử lý / lỗi / PDF / ảnh / chữ / không xem trước được.
 * PDF dùng trình xem PDF của trình duyệt (URL ký sẵn, Content-Disposition inline).
 */
export function FilePreviewPane({
  detail,
  onDownload,
  onReplace,
}: {
  detail: FileDetail;
  onDownload?: () => void;
  onReplace?: () => void;
}) {
  const { node, currentVersion: v } = detail;
  const versionId = v?.id ?? null;
  const preview = useApi(() => api<FilePreview>(`/files/${node.id}/preview`), [node.id, versionId], {
    enabled: !!v && node.type === "FILE" && v.previewKind !== "none",
  });

  if (node.type === "VIDEO") {
    return (
      <Centered>
        <Clapperboard className="size-5 text-muted" aria-hidden />
        <p className="text-sm font-medium text-foreground">{node.status === "FAILED" ? "Không xử lý được video này" : "Video đang chờ xử lý để phát"}</p>
        <p className="max-w-[48ch] text-sm text-pretty text-muted">
          {node.status === "FAILED" && detail.processingError ? detail.processingError : "Trình phát video có ở bản sau. Video chỉ xem trên Luna, không tải về được."}
        </p>
      </Centered>
    );
  }

  if (!v) {
    if (node.status === "FAILED") {
      return (
        <Centered>
          <CircleAlert className="size-5 text-err" aria-hidden />
          <p className="text-sm font-medium text-foreground">Không xử lý được tệp này</p>
          <p className="max-w-[48ch] text-sm text-pretty text-muted">{detail.processingError ?? "Tệp có thể bị hỏng hoặc không đúng định dạng."}</p>
          {onReplace ? (
            <Button icon={Upload} className="mt-2" onClick={onReplace}>
              Tải tệp khác lên
            </Button>
          ) : null}
        </Centered>
      );
    }
    return (
      <Centered>
        <LoaderCircle className="size-5 animate-spin text-muted motion-reduce:animate-none" aria-hidden />
        <p className="text-sm font-medium text-foreground">{node.status === "UPLOADING" ? "Tệp đang được tải lên" : "Đang xử lý tệp"}</p>
        <p className="max-w-[48ch] text-sm text-pretty text-muted">
          {node.status === "UPLOADING" ? "Bản xem trước hiện khi tải lên và xử lý xong." : "Bản xem trước sẽ hiện ngay khi xong, thường dưới một phút."}
        </p>
      </Centered>
    );
  }

  if (v.previewKind === "none") {
    return (
      <Centered>
        <p className="text-sm font-medium text-foreground">Định dạng này chưa có bản xem trước</p>
        <p className="max-w-[48ch] text-sm text-pretty text-muted">Tải về để mở bằng ứng dụng trên máy.</p>
        {onDownload ? (
          <Button icon={Download} className="mt-2" onClick={onDownload}>
            Tải về
          </Button>
        ) : null}
      </Centered>
    );
  }

  if (preview.error) {
    return (
      <Centered>
        <CircleAlert className="size-5 text-err" aria-hidden />
        <p className="text-sm font-medium text-foreground">Không tải được bản xem trước</p>
        <Button className="mt-2" onClick={() => void preview.reload()}>
          Thử lại
        </Button>
      </Centered>
    );
  }
  const url = preview.data?.url;
  if (!url) return <div className={`animate-pulse bg-foreground/3 ${VIEW_H}`} aria-busy="true" aria-label="Đang tải bản xem trước" />;

  if (v.previewKind === "pdf") {
    return <PdfViewer url={url} title={`Xem trước ${node.name}`} className={VIEW_H} />;
  }
  if (v.previewKind === "image") {
    return (
      // Ảnh không ép khung cao cố định: ảnh ngang trên điện thoại không bị kẹp giữa một khoảng trống lớn.
      <div className="flex min-h-64 items-center justify-center bg-background p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={node.name} className="max-h-[calc(100dvh-17rem)] max-w-full rounded-lg object-contain" />
      </div>
    );
  }
  return <TextPreview url={url} />;
}
