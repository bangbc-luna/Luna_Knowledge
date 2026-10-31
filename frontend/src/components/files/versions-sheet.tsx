"use client";

import { Download } from "lucide-react";
import { useState } from "react";
import { api, describeError } from "@/lib/api";
import { formatBytes } from "@/lib/files";
import { formatWhen } from "@/lib/format";
import type { FileVersion, NodeItem } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { Button, IconButton } from "../ui/button";
import { Sheet } from "../ui/dialog";
import { Badge, EmptyState, ErrorBanner, SkeletonRows } from "../ui/misc";
import { useToast } from "../ui/toast";

export function VersionsSheet({
  node,
  open,
  onClose,
  canRestore,
  canDownload,
  onDownload,
  onRestored,
}: {
  node: NodeItem;
  open: boolean;
  onClose: () => void;
  canRestore: boolean;
  canDownload: boolean;
  onDownload: (versionId: string) => void;
  onRestored: () => void;
}) {
  const toast = useToast();
  const versions = useApi(() => api<FileVersion[]>(`/files/${node.id}/versions`), [node.id, node.updatedAt], { enabled: open });
  const [busy, setBusy] = useState<string | null>(null);

  const restore = async (v: FileVersion) => {
    setBusy(v.id);
    try {
      await api(`/files/${node.id}/versions/${v.id}/restore`, { method: "POST" });
      toast("success", `Đã dùng lại phiên bản ${v.versionNo}`);
      await versions.reload();
      onRestored();
    } catch (err) {
      toast("error", describeError(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Lịch sử phiên bản" subtitle={<span className="block truncate">{node.name}</span>}>
      {versions.loading && !versions.data ? (
        <SkeletonRows rows={3} />
      ) : versions.error ? (
        <ErrorBanner error={versions.error} what="lịch sử phiên bản" onRetry={() => void versions.reload()} />
      ) : !versions.data?.length ? (
        <EmptyState text="Tệp chưa có phiên bản nào." />
      ) : (
        <ul className="divide-y divide-border px-6">
          {versions.data.map((v) => (
            <li key={v.id} className="flex items-center gap-3 py-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-foreground tabular-nums">Phiên bản {v.versionNo}</p>
                  {v.isCurrent ? (
                    <Badge tone="primary" small>
                      Hiện tại
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-0.5 text-xs text-muted tabular-nums">
                  {v.uploadedBy.name} · {formatWhen(v.createdAt, { withTime: true })} · {formatBytes(v.size)}
                </p>
                {v.fileName !== node.name ? (
                  <p className="mt-0.5 truncate text-xs text-muted" title={v.fileName}>
                    {v.fileName}
                  </p>
                ) : null}
              </div>
              {canRestore && !v.isCurrent ? (
                <Button size="sm" loading={busy === v.id} onClick={() => void restore(v)}>
                  Khôi phục
                </Button>
              ) : null}
              {canDownload ? <IconButton icon={Download} label={`Tải phiên bản ${v.versionNo}`} onClick={() => onDownload(v.id)} /> : null}
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
