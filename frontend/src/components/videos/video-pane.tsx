"use client";

import { CircleAlert, LoaderCircle, RotateCw } from "lucide-react";
import type { FileDetail, VideoDetail } from "@/lib/types";
import { Button } from "../ui/button";
import { VideoPlayer } from "./video-player";

function Progress({ percent }: { percent: number | null }) {
  const value = Math.round(percent ?? 0);
  return (
    <div className="mt-3 flex w-full max-w-72 items-center gap-3">
      <div role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label="Tiến độ xử lý video" className="h-1 flex-1 rounded-full bg-foreground/5">
        <div className="h-1 rounded-full bg-primary transition-[width] duration-500" style={{ width: `${value}%` }} />
      </div>
      <p className="w-10 shrink-0 text-right text-sm text-muted tabular-nums">{value}%</p>
    </div>
  );
}

export function VideoPane({
  detail,
  video,
  progress,
  onRetranscode,
  retranscoding,
}: {
  detail: FileDetail;
  video: VideoDetail | null;
  progress: number | null;
  onRetranscode?: () => void;
  retranscoding?: boolean;
}) {
  const { node } = detail;
  const playable = !!video?.video;
  const processing = node.status === "PROCESSING" || node.status === "UPLOADING";

  if (playable) {
    return (
      <>
        {processing ? (
          <div role="status" className="flex items-center gap-3 border-b border-border px-4 py-3">
            <LoaderCircle className="size-4 shrink-0 animate-spin text-muted motion-reduce:animate-none" aria-hidden />
            <p className="min-w-0 flex-1 text-sm text-foreground">Đang xử lý phiên bản mới, bản đang phát vẫn xem được.</p>
            {progress !== null ? <p className="shrink-0 text-sm text-muted tabular-nums">{Math.round(progress)}%</p> : null}
          </div>
        ) : null}
        <VideoPlayer key={video.video!.transcodedAt} nodeId={node.id} title={node.name} />
      </>
    );
  }

  return (
    <div className="flex aspect-video w-full flex-col items-center justify-center bg-background px-6 text-center">
      {node.status === "FAILED" ? (
        <>
          <CircleAlert className="size-5 text-err" aria-hidden />
          <p className="mt-2 text-sm font-medium text-foreground">Không xử lý được video này</p>
          <p className="mt-1 max-w-[48ch] text-sm text-pretty text-muted">{detail.processingError ?? video?.processingError ?? "Tệp có thể bị hỏng hoặc không đúng định dạng video."}</p>
          {onRetranscode ? (
            <Button icon={RotateCw} className="mt-4" loading={retranscoding} onClick={onRetranscode}>
              Transcode lại
            </Button>
          ) : null}
        </>
      ) : (
        <>
          <LoaderCircle className="size-5 animate-spin text-muted motion-reduce:animate-none" aria-hidden />
          <p className="mt-2 text-sm font-medium text-foreground">{node.status === "UPLOADING" ? "Video đang được tải lên" : "Đang xử lý video"}</p>
          <p className="mt-1 max-w-[48ch] text-sm text-pretty text-muted">
            {node.status === "UPLOADING" ? "Xử lý bắt đầu ngay khi tải lên xong." : "Chuyển sang nhiều mức chất lượng để xem mượt trên mọi mạng. Video dài có thể mất vài chục phút."}
          </p>
          {node.status === "PROCESSING" ? <Progress percent={progress} /> : null}
        </>
      )}
    </div>
  );
}
