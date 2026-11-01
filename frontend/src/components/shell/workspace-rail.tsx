"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { workspaceAbbr } from "@/lib/format";
import type { MeWorkspace } from "@/lib/types";
import { useShellWorkspace } from "@/lib/workspace";
import { CreateWorkspaceDialog } from "./workspace-dialogs";

const tile =
  "inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold outline-hidden transition-colors focus-visible:ring-[3px] focus-visible:ring-rail-foreground focus-visible:ring-offset-4 focus-visible:ring-offset-rail";

export function WorkspaceRail() {
  const { me } = useAuth();
  const { ws } = useShellWorkspace();
  const [creating, setCreating] = useState(false);
  const list = me?.workspaces ?? [];
  const company = list.filter((w) => w.kind === "COMPANY");
  const teams = list.filter((w) => w.kind !== "COMPANY");
  const item = (w: MeWorkspace) => {
    const active = w.id === ws?.id;
    const label = list.filter((o) => o.name === w.name).length > 1 ? `${w.name} (${w.kind === "COMPANY" ? "công ty" : w.slug})` : w.name;
    return (
      <Link
        key={w.id}
        href={`/w/${w.id}/f`}
        title={label}
        aria-label={label}
        aria-current={active ? "page" : undefined}
        className={cn(
          tile,
          active
            ? "bg-rail-active text-rail-foreground ring-2 ring-rail-foreground ring-offset-2 ring-offset-rail"
            : "bg-rail-item text-rail-foreground hover:bg-rail-item-hover",
        )}
      >
        <span aria-hidden>{workspaceAbbr(w.name)}</span>
      </Link>
    );
  };
  return (
    <nav aria-label="Workspace" className="flex h-full w-12 shrink-0 flex-col items-center gap-2 overflow-y-auto bg-rail py-2">
      {company.map(item)}
      {company.length && teams.length ? <span className="h-px w-6 shrink-0 bg-rail-item" aria-hidden /> : null}
      {teams.map(item)}
      <button
        type="button"
        title="Tạo workspace"
        aria-label="Tạo workspace"
        onClick={() => setCreating(true)}
        className={cn(tile, "cursor-pointer border border-dashed border-rail-item-hover text-rail-foreground/70 hover:bg-rail-item hover:text-rail-foreground")}
      >
        <Plus className="size-4" aria-hidden />
      </button>
      <CreateWorkspaceDialog open={creating} onClose={() => setCreating(false)} />
    </nav>
  );
}
