"use client";

import { formatWhen } from "@/lib/format";
import type { NodeItem } from "@/lib/types";
import { RowMenu, type MenuAction } from "../ui/menu";
import { FavoriteButton } from "./favorite-button";
import { nodeMeta, NodeName, TagCell, TagChip } from "./node-name";

export function FolderTable({
  items,
  menuFor,
  onFavorite,
}: {
  items: NodeItem[];
  menuFor: (n: NodeItem) => MenuAction[][];
  onFavorite: (id: string, fav: boolean) => void;
}) {
  return (
    <div className="border-y border-border">
      <table className="w-full border-collapse">
        <thead className="hidden sm:table-header-group">
          <tr className="text-left text-xs font-medium text-muted">
            <th className="h-8 px-3 font-medium">Tên</th>
            <th className="hidden h-8 px-3 font-medium whitespace-nowrap @2xl:table-cell">Loại</th>
            <th className="hidden h-8 px-3 font-medium @4xl:table-cell">Tag</th>
            <th className="hidden h-8 px-3 font-medium whitespace-nowrap @3xl:table-cell">Người tạo</th>
            <th className="h-8 w-px px-3 font-medium whitespace-nowrap">Sửa lần cuối</th>
            <th className="h-8 w-px px-2 whitespace-nowrap">
              <span className="sr-only">Thao tác</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((n) => (
            <tr key={n.id} className="relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 border-t border-border px-3 py-2 hover:bg-surface-hover first:border-t-0 sm:table-row sm:px-0 sm:py-0 sm:first:border-t">
              <td className="min-w-0 sm:h-9 sm:w-full sm:max-w-0 sm:px-3">
                <NodeName node={n} stretched dense />
                {n.tags.length ? (
                  <div className="mt-1.5 flex flex-wrap gap-1 pl-[34px] @4xl:hidden">
                    {n.tags.map((t) => (
                      <TagChip key={t.id} tag={t} />
                    ))}
                  </div>
                ) : null}
              </td>
              <td className="hidden px-3 text-sm whitespace-nowrap text-muted @2xl:table-cell">{nodeMeta(n)}</td>
              <td className="hidden px-3 whitespace-nowrap @4xl:table-cell">
                <TagCell tags={n.tags} />
              </td>
              <td className="hidden px-3 text-sm whitespace-nowrap text-foreground/80 @3xl:table-cell">{n.createdBy.name}</td>
              <td className="hidden px-3 text-sm whitespace-nowrap text-muted tabular-nums sm:table-cell">{formatWhen(n.updatedAt)}</td>
              <td className="whitespace-nowrap sm:w-px sm:px-2">
                <div className="relative z-10 flex flex-nowrap items-center justify-end gap-0.5">
                  <FavoriteButton node={n} onChange={(fav) => onFavorite(n.id, fav)} />
                  <RowMenu groups={menuFor(n)} size="touch" />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
