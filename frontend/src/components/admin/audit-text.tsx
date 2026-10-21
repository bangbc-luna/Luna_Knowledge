"use client";

import { Eye, FolderInput, FolderPlus, LogIn, LogOut, Pencil, Settings, Share2, ShieldAlert, Trash2, Undo2, UserX, type LucideIcon } from "lucide-react";
import { ACTION_LABEL } from "@/lib/format";
import type { AuditItem } from "@/lib/types";
import { Badge, type BadgeTone } from "../ui/misc";

const ICONS: Array<[RegExp, LucideIcon]> = [
  [/^node\.view$/, Eye],
  [/^node\.create$/, FolderPlus],
  [/^node\.rename$/, Pencil],
  [/^node\.move$/, FolderInput],
  [/^node\.restore$/, Undo2],
  [/^(node\.trash|node\.delete_permanent|trash\.empty)$/, Trash2],
  [/^share\.remove$/, UserX],
  [/^share\./, Share2],
  [/^auth\.login_failed|auth\.session_revoked$/, ShieldAlert],
  [/^auth\.logout$/, LogOut],
  [/^auth\./, LogIn],
];

export function actionTone(action: string): BadgeTone {
  if (action === "auth.login_failed" || action === "auth.session_revoked") return "err";
  if (action === "node.delete_permanent" || action === "trash.empty" || action === "workspace.delete") return "warn";
  return "neutral";
}

export function ActionBadge({ action }: { action: string }) {
  const Icon = ICONS.find(([re]) => re.test(action))?.[1] ?? Settings;
  return (
    <Badge tone={actionTone(action)}>
      <Icon className="size-3.5" aria-hidden />
      {ACTION_LABEL[action] ?? action}
    </Badge>
  );
}

export function targetText(item: AuditItem): string | null {
  if (!item.target || item.target.type === "session") return null;
  return item.target.label ?? `#${item.target.id.slice(0, 8)}`;
}

export function actorName(item: AuditItem): string {
  if (item.actor) return item.actor.name;
  const email = typeof item.metadata?.email === "string" ? (item.metadata.email as string) : null;
  return email ?? "Hệ thống";
}

export function AuditSentence({ item }: { item: AuditItem }) {
  const target = targetText(item);
  return (
    <>
      <span className="font-medium text-foreground">{actorName(item)}</span> {(ACTION_LABEL[item.action] ?? item.action).toLowerCase()}
      {target ? (
        <>
          {" "}
          <span className="font-medium text-foreground">{target}</span>
        </>
      ) : null}
    </>
  );
}

export function shortAgent(ua: string | null): string {
  if (!ua) return "—";
  const browser = /Edg\/(\d+)/.exec(ua) ? `Edge ${/Edg\/(\d+)/.exec(ua)![1]}` : /Chrome\/(\d+)/.exec(ua) ? `Chrome ${/Chrome\/(\d+)/.exec(ua)![1]}` : /Firefox\/(\d+)/.exec(ua) ? `Firefox ${/Firefox\/(\d+)/.exec(ua)![1]}` : /Version\/(\d+).*Safari/.exec(ua) ? `Safari ${/Version\/(\d+)/.exec(ua)![1]}` : ua.split(" ")[0]!;
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} · ${os}` : browser;
}
