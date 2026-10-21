"use client";

import { FileText, Folder, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { fileKindLabel, formatBytes } from "@/lib/files";
import { TYPE_LABEL } from "@/lib/format";
import type { NodeItem, Tag } from "@/lib/types";
import { useThumbnail } from "@/lib/use-thumbnail";
import { FileTypeIcon } from "../files/file-type-icon";
import { Badge } from "../ui/misc";

export function nodeHref(node: Pick<NodeItem, "id" | "type" | "workspaceId" | "parentId" | "section">) {
  if (node.type === "FOLDER") return `/w/${node.workspaceId}/${node.section === "VIDEOS" ? "v" : "f"}/${node.id}`;
  if (node.type === "FILE" || node.type === "VIDEO") return `/w/${node.workspaceId}/file/${node.id}`;
  return `/w/${node.workspaceId}/doc/${node.id}`;
}

export function NodeIcon({ node }: { node: NodeItem }) {
  const isImage = node.type === "FILE" && node.status === "READY" && !!node.mime?.startsWith("image/");
  const thumb = useThumbnail(node.id, isImage);
  if (thumb) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={thumb} alt="" className="size-8 shrink-0 rounded-lg bg-foreground/5 object-cover" />;
  }
  return (
    <span className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-lg", node.type === "FOLDER" ? "bg-primary-light text-primary" : "bg-foreground/5 text-foreground/70")}>
      {node.type === "FOLDER" ? (
        <Folder className="size-4" aria-hidden />
      ) : node.type === "DOCUMENT" ? (
        <FileText className="size-4" aria-hidden />
      ) : (
        <FileTypeIcon name={node.name} mime={node.type === "VIDEO" ? "video/mp4" : node.mime} className="size-4" />
      )}
    </span>
  );
}

export function nodeMeta(node: NodeItem): string {
  if (node.type === "FOLDER") return `${TYPE_LABEL.FOLDER} · ${node.childCount ? `${node.childCount} mục` : "Trống"}`;
  if (node.type === "FILE") return node.size !== null ? `${fileKindLabel(node.name, node.mime)} · ${formatBytes(node.size)}` : fileKindLabel(node.name, node.mime);
  if (node.type === "VIDEO") return node.size !== null ? `Video · ${formatBytes(node.size)}` : "Video";
  return TYPE_LABEL[node.type];
}

export function NodeName({ node, sub, stretched = false }: { node: NodeItem; sub?: React.ReactNode; stretched?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <NodeIcon node={node} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <Link href={nodeHref(node)} title={node.name} className={cn("block min-h-6 min-w-0 truncate py-0.5 text-sm/5 font-medium text-foreground hover:underline", stretched && "after:absolute after:inset-0 after:content-['']")}>
            {node.name}
          </Link>
          {node.status === "PROCESSING" || node.status === "UPLOADING" ? (
            <Badge tone="warn">
              <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" aria-hidden />
              {node.status === "UPLOADING" ? "Đang tải lên" : "Đang xử lý"}
            </Badge>
          ) : node.status === "FAILED" ? (
            <Badge tone="err">Lỗi xử lý</Badge>
          ) : null}
        </div>
        <p className="mt-0.5 truncate text-xs text-muted">
          {sub ?? nodeMeta(node)}
        </p>
      </div>
    </div>
  );
}

export function TagChip({ tag }: { tag: Tag }) {
  return (
    <span className="inline-flex h-6 max-w-32 shrink-0 items-center gap-1.5 rounded-full bg-foreground/5 px-2 text-xs font-medium text-foreground/70" title={tag.name}>
      <span className="size-2 shrink-0 rounded-full" style={{ background: tag.color }} aria-hidden />
      <span className="truncate">{tag.name}</span>
    </span>
  );
}

export function TagCell({ tags }: { tags: Tag[] }) {
  if (!tags.length) return <span className="text-sm text-muted">—</span>;
  return (
    <div className="flex flex-nowrap gap-1">
      <TagChip tag={tags[0]!} />
      {tags.length > 1 ? (
        <span className="inline-flex h-6 shrink-0 items-center rounded-full bg-foreground/5 px-2 text-xs font-medium text-foreground/70" title={tags.slice(1).map((t) => t.name).join(", ")}>
          +{tags.length - 1}
        </span>
      ) : null}
    </div>
  );
}
