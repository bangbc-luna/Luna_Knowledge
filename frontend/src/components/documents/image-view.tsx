"use client";

import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { ImageOff } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { api } from "@/lib/api";
import type { DocAsset } from "@/lib/documents";

const urls = new Map<string, string>();
const listeners = new Set<() => void>();
let currentDoc: string | null = null;
let loading: Promise<void> | null = null;
let lastLoad = 0;

export function setAssetDocument(nodeId: string, assets?: DocAsset[]) {
  if (currentDoc !== nodeId) {
    currentDoc = nodeId;
    urls.clear();
    lastLoad = 0;
  }
  if (assets) rememberAssets(assets);
}

export function rememberAssets(assets: DocAsset[]) {
  for (const a of assets) urls.set(a.id, a.url);
  listeners.forEach((l) => l());
}

function refreshAssets() {
  if (!currentDoc || loading || Date.now() - lastLoad < 10_000) return;
  const doc = currentDoc;
  lastLoad = Date.now();
  loading = api<DocAsset[]>(`/documents/${doc}/assets`)
    .then((list) => {
      if (doc === currentDoc) rememberAssets(list);
    })
    .catch(() => undefined)
    .finally(() => {
      loading = null;
    });
}

function useAssetUrl(assetId: string | null) {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => (assetId ? (urls.get(assetId) ?? null) : null),
    () => null,
  );
}

export function ImageView({ node }: ReactNodeViewProps) {
  const assetId = (node.attrs.assetId as string | null) ?? null;
  const fresh = useAssetUrl(assetId);
  const src = fresh ?? (node.attrs.src as string);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = failedSrc === src;

  return (
    <NodeViewWrapper as="figure" className="luna-image" data-drag-handle>
      {failed ? (
        <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-xl bg-foreground/5 text-sm text-muted">
          <ImageOff className="size-5" aria-hidden />
          Không tải được ảnh
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={(node.attrs.alt as string | null) ?? ""}
          draggable={false}
          className="rounded-xl"
          onError={() => {
            if (assetId && !fresh) refreshAssets();
            setFailedSrc(src);
          }}
        />
      )}
    </NodeViewWrapper>
  );
}
