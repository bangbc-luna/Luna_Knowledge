"use client";

import { FileText, LoaderCircle, RotateCw } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { docHref } from "@/lib/documents";
import { getMinutes, retryMinutes } from "@/lib/meetings";
import { useApi } from "@/lib/use-api";
import { Button } from "../ui/button";
import { focusRing } from "../ui/focus";
import { Badge, Card, ErrorBanner, SkeletonRows } from "../ui/misc";
import { useToast } from "../ui/toast";
import { cn } from "@/lib/cn";
import { meetingErrorText } from "./meeting-errors";
import { MinutesDraftEditor } from "./minutes-draft-editor";

const POLL_MS = 15_000;

export function MinutesPanel({ wsId, meetingId }: { wsId: string; meetingId: string }) {
  const toast = useToast();
  const minutes = useApi(() => getMinutes(meetingId), [meetingId]);
  const [retrying, setRetrying] = useState(false);
  const [round, setRound] = useState(0);
  const data = minutes.data;
  const status = data?.status;
  const polling = status === "RECORDING" || status === "PROCESSING" || status === "PUBLISHING";
  const reload = minutes.reload;

  useEffect(() => {
    if (!polling) return;
    const id = setInterval(() => void reload(), POLL_MS);
    return () => clearInterval(id);
  }, [polling, reload]);

  const reloadAll = () => {
    setRound((n) => n + 1);
    void reload();
  };

  const retry = async () => {
    setRetrying(true);
    try {
      await retryMinutes(meetingId);
      void reload();
    } catch (err) {
      toast("error", meetingErrorText(err));
      void reload();
    } finally {
      setRetrying(false);
    }
  };

  let body: React.ReactNode;
  if (minutes.error && !data) {
    body = <ErrorBanner error={minutes.error} what="biên bản" onRetry={() => void reload()} />;
  } else if (!data) {
    body = (
      <div aria-busy="true">
        <SkeletonRows rows={2} />
      </div>
    );
  } else if (data.status === "NONE") {
    body = <p className="mt-2 text-sm text-muted text-pretty">Buổi họp này không ghi biên bản.</p>;
  } else if (polling) {
    body = (
      <p role="status" className="mt-2 flex items-center gap-2 text-sm text-muted text-pretty">
        <LoaderCircle className="size-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
        {data.status === "PUBLISHING" ? "Đang gửi biên bản…" : "Đang xử lý biên bản…"}
      </p>
    );
  } else if (data.status === "AWAITING_REVIEW") {
    body =
      data.canReview && data.draft ? (
        <MinutesDraftEditor key={`${data.draft.revision}-${round}`} meetingId={meetingId} minutes={data} draft={data.draft} onReload={reloadAll} onPublished={() => void reload()} />
      ) : (
        <p className="mt-2 text-sm text-muted text-pretty">Biên bản đang chờ người chủ trì duyệt.</p>
      );
  } else if (data.status === "PUBLISHED") {
    body = data.documentNodeId ? (
      <Link href={docHref(wsId, data.documentNodeId)} className={cn("mt-2 inline-flex min-h-10 items-center gap-2 rounded-xl border border-border-strong bg-surface px-4 text-sm font-medium hover:bg-button-hover", focusRing)}>
        <FileText className="size-4" aria-hidden />
        Mở biên bản
      </Link>
    ) : (
      <p className="mt-2 text-sm text-muted text-pretty">Biên bản đã gửi.</p>
    );
  } else {
    body = (
      <div className="mt-2 flex flex-col gap-3">
        <p className="text-sm text-muted text-pretty">
          Không tạo được biên bản.
          {data.canReview && data.error ? <span className="mt-1 block line-clamp-3 [overflow-wrap:anywhere]">{data.error}</span> : null}
        </p>
        {data.canReview ? (
          <div>
            <Button icon={RotateCw} loading={retrying} onClick={() => void retry()}>
              Thử lại
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <FileText className="size-4 text-muted" aria-hidden />
          Biên bản
        </h2>
        {status === "AWAITING_REVIEW" ? <Badge tone="warn">Chờ duyệt</Badge> : null}
        {status === "PUBLISHED" ? <Badge tone="ok">Đã gửi</Badge> : null}
        {status === "FAILED" ? <Badge tone="err">Lỗi</Badge> : null}
      </div>
      {body}
    </Card>
  );
}
