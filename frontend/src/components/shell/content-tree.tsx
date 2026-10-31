"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useReducer, useRef } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { roleAtLeast, sectionPath } from "@/lib/format";
import { expandTreeNodes, toggleTreeNode, useExpandedTree, useTreeTick } from "@/lib/tree-sync";
import type { NodeItem, NodeSection, Page } from "@/lib/types";
import { useUploads } from "@/lib/uploads";
import { NodeIcon, nodeHref } from "../content/node-name";
import { TreeCreateMenu } from "./tree-create-menu";

const LIMIT = 200;
const MAX_INDENT_DEPTH = 6;

interface BranchEntry {
  version: string;
  data: Page<NodeItem> | null;
  error: unknown;
  pending: Promise<void> | null;
}

const branches = new Map<string, BranchEntry>();
const crumbRequests = new Map<string, Promise<Array<{ id: string }> | null>>();

const indent = (depth: number) => ({ paddingLeft: 4 + Math.min(depth, MAX_INDENT_DEPTH) * 12 });

function useBranch(wsId: string, section: NodeSection, parentId: string | null) {
  const tick = useTreeTick(wsId);
  const done = useUploads().doneTick(wsId, parentId);
  const key = `${wsId}:${section}:${parentId ?? ""}`;
  const version = `${tick}:${done}`;
  const [attempt, rerender] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    const current = branches.get(key);
    if (current && current.version === version) {
      if (current.pending) void current.pending.then(rerender);
      return;
    }
    const entry: BranchEntry = { version, data: current?.data ?? null, error: null, pending: null };
    entry.pending = api<Page<NodeItem>>(`/workspaces/${wsId}/nodes`, {
      query: { parentId: parentId ?? undefined, section: parentId ? undefined : section, sort: "name", order: "asc", limit: LIMIT },
    }).then(
      (data) => {
        entry.data = data;
        entry.pending = null;
      },
      (error: unknown) => {
        entry.error = error;
        entry.pending = null;
      },
    );
    branches.set(key, entry);
    rerender();
    void entry.pending.then(rerender);
  }, [key, version, wsId, section, parentId, attempt]);

  const entry = branches.get(key);
  const fresh = entry?.version === version ? entry : null;
  return {
    data: entry?.data ?? null,
    error: fresh && !fresh.pending ? fresh.error : null,
    retry: () => {
      branches.delete(key);
      rerender();
    },
  };
}

function Branch({
  wsId,
  section,
  parentId,
  depth,
  activeId,
}: {
  wsId: string;
  section: NodeSection;
  parentId: string | null;
  depth: number;
  activeId: string | null;
}) {
  const { data, error, retry } = useBranch(wsId, section, parentId);
  const textPad = { paddingLeft: indent(depth).paddingLeft + 20 + 24 };

  if (!data && error) {
    return (
      <li role="none" className="flex h-7 items-center gap-1 text-xs text-muted" style={textPad}>
        Không tải được ·
        <button type="button" onClick={retry} className="cursor-pointer rounded font-medium text-foreground underline-offset-2 outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-primary">
          Thử lại
        </button>
      </li>
    );
  }
  if (!data) {
    return (
      <li role="none">
        <div role="status" aria-busy="true" aria-label="Đang tải" className="flex flex-col">
          {[64, 48, 56].map((w, i) => (
            <span key={i} className="flex h-7 items-center gap-2" style={{ paddingLeft: indent(depth).paddingLeft + 20 }}>
              <span className="size-4 shrink-0 animate-pulse rounded bg-foreground/6" />
              <span className="h-2.5 animate-pulse rounded-full bg-foreground/6" style={{ width: `${w}%` }} />
            </span>
          ))}
        </div>
      </li>
    );
  }
  if (!data.items.length) {
    return (
      <li role="none" className="flex h-7 items-center text-xs text-muted" style={textPad}>
        {parentId ? "Thư mục trống" : section === "VIDEOS" ? "Chưa có video nào" : "Chưa có tài liệu nào"}
      </li>
    );
  }
  const base = `/w/${wsId}/${sectionPath(section)}`;
  return (
    <>
      {data.items.map((node) => (
        <TreeRow key={node.id} node={node} wsId={wsId} section={section} depth={depth} activeId={activeId} />
      ))}
      {data.nextCursor ? (
        <li role="none" style={textPad}>
          <Link href={parentId ? `${base}/${parentId}` : base} className="flex h-7 items-center rounded-md text-xs font-medium text-primary outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-primary">
            Xem tất cả
          </Link>
        </li>
      ) : null}
      {error ? (
        <li role="none" className="flex h-7 items-center gap-1 text-xs text-muted" style={textPad}>
          Không tải được ·
          <button type="button" onClick={retry} className="cursor-pointer rounded font-medium text-foreground outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-primary">
            Thử lại
          </button>
        </li>
      ) : null}
    </>
  );
}

function TreeRow({ node, wsId, section, depth, activeId }: { node: NodeItem; wsId: string; section: NodeSection; depth: number; activeId: string | null }) {
  const scope = `${wsId}:${section}`;
  const expanded = useExpandedTree(scope);
  const isFolder = node.type === "FOLDER";
  const open = isFolder && expanded.has(node.id);
  const active = node.id === activeId;
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active) rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);
  const canCreate = isFolder && roleAtLeast(node.myRole, "EDITOR");

  return (
    <li role="treeitem" aria-level={depth + 1} aria-expanded={isFolder ? open : undefined} aria-selected={active} className="flex flex-col">
      <div
        ref={rowRef}
        className={cn("group relative flex h-7 items-center gap-1 rounded-lg pr-1", active ? "bg-primary-light" : "hover:bg-item-hover")}
        style={indent(depth)}
      >
        {isFolder ? (
          <button
            type="button"
            aria-label={open ? `Thu gọn «${node.name}»` : `Mở «${node.name}»`}
            aria-expanded={open}
            onClick={() => toggleTreeNode(scope, node.id)}
            className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted outline-hidden hover:bg-foreground/8 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
          >
            <ChevronRight className={cn("size-3.5 transition-transform motion-reduce:transition-none", open && "rotate-90")} aria-hidden />
          </button>
        ) : (
          <span className="size-5 shrink-0" />
        )}
        <Link
          href={nodeHref(node)}
          title={node.name}
          aria-current={active ? "page" : undefined}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 self-stretch rounded-md text-sm outline-hidden focus-visible:ring-2 focus-visible:ring-primary",
            active ? "font-medium text-foreground" : "text-foreground/80 group-hover:text-foreground",
            canCreate && "group-focus-within:pr-6 group-hover:pr-6 [@media(hover:none)]:pr-6",
          )}
        >
          <NodeIcon node={node} compact open={open} />
          <span className="min-w-0 truncate">{node.name}</span>
        </Link>
        {canCreate ? (
          <div className="pointer-events-none absolute inset-y-0 right-1 flex items-center opacity-0 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 has-[[aria-expanded=true]]:pointer-events-auto has-[[aria-expanded=true]]:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100">
            <TreeCreateMenu wsId={wsId} section={section} parentId={node.id} label={`Tạo mới trong «${node.name}»`} />
          </div>
        ) : null}
      </div>
      {open ? (
        <ul role="group" className="flex flex-col">
          <Branch wsId={wsId} section={section} parentId={node.id} depth={depth + 1} activeId={activeId} />
        </ul>
      ) : null}
    </li>
  );
}

function useRevealActive(wsId: string, section: NodeSection, activeId: string | null) {
  const tick = useTreeTick(wsId);
  useEffect(() => {
    if (!activeId) return;
    const key = `${activeId}:${tick}`;
    let request = crumbRequests.get(key);
    if (!request) {
      request = api<Array<{ id: string }>>(`/nodes/${activeId}/breadcrumb`).catch(() => null);
      crumbRequests.set(key, request);
    }
    let live = true;
    void request.then((crumbs) => {
      if (live && crumbs && crumbs.length > 1) expandTreeNodes(`${wsId}:${section}`, crumbs.slice(0, -1).map((c) => c.id));
    });
    return () => {
      live = false;
    };
  }, [wsId, section, activeId, tick]);
}

export function ContentTree({ wsId, section, activeId }: { wsId: string; section: NodeSection; activeId: string | null }) {
  useRevealActive(wsId, section, activeId);
  return (
    <ul role="tree" aria-label={section === "VIDEOS" ? "Cây video" : "Cây tài liệu"} className="flex flex-col">
      <Branch key={`${wsId}:${section}`} wsId={wsId} section={section} parentId={null} depth={0} activeId={activeId} />
    </ul>
  );
}
