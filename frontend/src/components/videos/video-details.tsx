"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { formatNumber, formatWhen } from "@/lib/format";
import type { NodeItem, VideoDetail } from "@/lib/types";
import { Avatar, Card } from "../ui/misc";

function useClamped(text: string | null) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [clamped, setClamped] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setClamped(el.scrollHeight > el.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text]);
  return { ref, clamped };
}

export function VideoDetails({
  node,
  video,
  actions,
  onEditInfo,
}: {
  node: NodeItem;
  video: VideoDetail["video"];
  actions: React.ReactNode;
  onEditInfo?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const bodyId = useId();
  const { ref, clamped } = useClamped(node.description);
  const meta = [video ? `${formatNumber(video.viewCount)} lượt xem` : null, formatWhen(node.createdAt, { withTime: true })].filter(Boolean).join(" · ");

  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-xl font-semibold text-balance [overflow-wrap:anywhere]">{node.name}</h1>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={node.createdBy.name} src={node.createdBy.avatarUrl} size="size-9" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{node.createdBy.name}</p>
            <p className="truncate text-sm text-muted">{node.createdBy.email}</p>
          </div>
        </div>
        {actions}
      </div>

      <Card className="p-4 text-sm">
        <p className="font-medium text-foreground tabular-nums">{meta}</p>
        {node.description ? (
          <>
            <p ref={ref} id={bodyId} className={cn("mt-1 whitespace-pre-line text-pretty text-foreground [overflow-wrap:anywhere]", !expanded && "line-clamp-3")}>
              {node.description}
            </p>
            {clamped || expanded ? (
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={bodyId}
                onClick={() => setExpanded((e) => !e)}
                className="relative mt-1 cursor-pointer font-medium text-foreground before:absolute before:-inset-x-2 before:-inset-y-2.5 hover:text-primary"
              >
                {expanded ? "Ẩn bớt" : "Xem thêm"}
              </button>
            ) : null}
          </>
        ) : (
          <p className="mt-1 text-muted">
            Chưa có mô tả.
            {onEditInfo ? (
              <>
                {" "}
                <button type="button" onClick={onEditInfo} className="cursor-pointer font-medium text-foreground underline underline-offset-4 hover:text-primary">
                  Thêm mô tả
                </button>
              </>
            ) : null}
          </p>
        )}
      </Card>
    </div>
  );
}
