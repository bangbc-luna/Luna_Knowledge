"use client";

import { FilePlus2, FolderPlus, Plus, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { docHref } from "@/lib/documents";
import { DOC_ACCEPT_ATTR, extensionOf, VIDEO_ACCEPT_ATTR, VIDEO_EXTENSIONS } from "@/lib/files";
import { expandTreeNodes, invalidateTree, useTreeScope } from "@/lib/tree-sync";
import type { NodeSection } from "@/lib/types";
import { useUploads } from "@/lib/uploads";
import { NameDialog, NewDocumentDialog } from "../content/node-dialogs";
import { RowMenu } from "../ui/menu";
import { useToast } from "../ui/toast";

export function TreeCreateMenu({
  wsId,
  section,
  parentId,
  label,
  className,
}: {
  wsId: string;
  section: NodeSection;
  parentId: string | null;
  label: string;
  className?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const uploads = useUploads();
  const fileInput = useRef<HTMLInputElement>(null);
  const [dialog, setDialog] = useState<"doc" | "folder" | null>(null);
  const isVideo = section === "VIDEOS";
  const scope = useTreeScope(wsId, section);
  const revealParent = () => {
    if (parentId) expandTreeNodes(scope, [parentId]);
  };

  const startUpload = (files: FileList | null) => {
    if (!files?.length) return;
    const all = Array.from(files);
    const fits = all.filter((f) => VIDEO_EXTENSIONS.includes(extensionOf(f.name)) === isVideo);
    const skipped = all.length - fits.length;
    if (skipped) toast("error", isVideo ? `Bỏ qua ${skipped} tệp không phải video. Tệp tài liệu tải lên ở mục Tài liệu.` : `Bỏ qua ${skipped} video. Video tải lên ở mục Video.`);
    if (fits.length) {
      uploads.add(fits, { wsId, parentId });
      revealParent();
    }
  };

  return (
    <>
      <RowMenu
        label={label}
        icon={Plus}
        className={cn("size-6 min-h-6 rounded-md", className)}
        panelClassName="min-w-48"
        groups={[
          [
            { icon: FilePlus2, label: "Tài liệu mới", onSelect: () => setDialog("doc"), hidden: isVideo },
            { icon: FolderPlus, label: "Thư mục mới", onSelect: () => setDialog("folder") },
            { icon: Upload, label: isVideo ? "Tải video lên" : "Tải lên", onSelect: () => fileInput.current?.click() },
          ],
        ]}
      />
      <input
        ref={fileInput}
        type="file"
        multiple
        accept={isVideo ? VIDEO_ACCEPT_ATTR : DOC_ACCEPT_ATTR}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          startUpload(e.target.files);
          e.target.value = "";
        }}
      />
      {isVideo ? null : (
        <NewDocumentDialog
          open={dialog === "doc"}
          onClose={() => setDialog(null)}
          workspaceId={wsId}
          parentId={parentId}
          onCreated={(doc, named) => {
            setDialog(null);
            revealParent();
            invalidateTree(wsId, [parentId]);
            router.push(`${docHref(wsId, doc.node.id)}${named ? "" : "?new=1"}`);
          }}
        />
      )}
      <NameDialog
        open={dialog === "folder"}
        onClose={() => setDialog(null)}
        title="Thư mục mới"
        submitLabel="Tạo thư mục"
        onSubmit={async (name) => {
          await api(`/workspaces/${wsId}/folders`, { method: "POST", body: { name, parentId, section } });
          toast("success", `Đã tạo thư mục «${name}»`);
          revealParent();
          invalidateTree(wsId, [parentId]);
        }}
      />
    </>
  );
}
