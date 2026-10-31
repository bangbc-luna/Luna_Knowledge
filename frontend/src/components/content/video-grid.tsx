"use client";

import { Folder, LoaderCircle, Play } from "lucide-react";
import Link from "next/link";
import type { NodeItem } from "@/lib/types";
import { useThumbnail } from "@/lib/use-thumbnail";
import { Badge } from "../ui/misc";
import { RowMenu, type MenuAction } from "../ui/menu";
import { FavoriteButton } from "./favorite-button";
import { nodeHref } from "./node-name";

function VideoPoster({ node }: { node: NodeItem }) {
  const poster = useThumbnail(node.type === "VIDEO" && node.status === "READY" ? `/api/v1/videos/${node.id}/poster` : null);
  return (
    <div className="relative aspect-video w-full bg-foreground/5 bg-cover bg-center" style={poster ? { backgroundImage: `url("${poster}")` } : undefined}>
      {poster ? null : (
        <span className="absolute inset-0 flex items-center justify-center text-foreground/40">
          <Play className="size-6" aria-hidden />
        </span>
      )}
      {node.status === "PROCESSING" || node.status === "UPLOADING" ? (
        <span className="absolute bottom-2 left-2">
          <Badge tone="warn">
            <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" aria-hidden />
            {node.status === "UPLOADING" ? "Đang tải lên" : "Đang xử lý"}
          </Badge>
        </span>
      ) : node.status === "FAILED" ? (
        <span className="absolute bottom-2 left-2">
          <Badge tone="err">Lỗi xử lý</Badge>
        </span>
      ) : null}
    </div>
  );
}

export function VideoGrid({
  items,
  menuFor,
  onFavorite,
}: {
  items: NodeItem[];
  menuFor: (n: NodeItem) => MenuAction[][];
  onFavorite: (id: string, fav: boolean) => void;
}) {
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-3">
      {items.map((n) => {
        const folder = n.type === "FOLDER";
        return (
          <li key={n.id} className="relative flex flex-col overflow-hidden rounded-xl border border-border bg-surface hover:bg-surface-hover">
            {folder ? (
              <div className="flex aspect-video w-full items-center justify-center bg-primary-light text-primary">
                <Folder className="size-8" aria-hidden />
              </div>
            ) : (
              <VideoPoster node={n} />
            )}
            <div className="flex items-start gap-1 p-2 pl-3">
              <div className="min-w-0 flex-1 py-1">
                <Link href={nodeHref(n)} title={n.name} className="line-clamp-2 text-sm/5 font-medium text-foreground after:absolute after:inset-0 after:content-[''] hover:underline">
                  {n.name}
                </Link>
                {folder ? <p className="mt-0.5 text-xs text-muted">{n.childCount ? `${n.childCount} mục` : "Trống"}</p> : null}
              </div>
              <div className="relative z-10 flex shrink-0 items-center">
                <FavoriteButton node={n} onChange={(fav) => onFavorite(n.id, fav)} />
                <RowMenu groups={menuFor(n)} />
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
