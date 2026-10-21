"use client";

import { Mail } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { UserSummary } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { Avatar, Card } from "../ui/misc";

export function NoWorkspaceNotice() {
  const { me } = useAuth();
  const none = !!me && !me.workspaces.length;
  const admins = useApi(() => api<UserSummary[]>("/users/admins"), [], { enabled: none });
  if (!none) return null;
  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold text-foreground">Bạn chưa thuộc workspace nào</h2>
      <p className="mt-1 max-w-[65ch] text-sm text-pretty text-muted">
        Kho tài liệu của mỗi nhóm nằm trong một workspace. Nhờ trưởng nhóm thêm bạn vào workspace của nhóm, hoặc liên hệ quản trị hệ thống. Trong lúc chờ, tài liệu người khác chia sẻ riêng cho bạn vẫn hiện ở mục Được chia sẻ.
      </p>
      {admins.data?.length ? (
        <ul className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {admins.data.map((a) => (
            <li key={a.id}>
              <a
                href={`mailto:${a.email}?subject=${encodeURIComponent("Xin thêm vào workspace trên Luna Knowledge")}`}
                className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-border-strong px-3 py-2 hover:bg-button-hover sm:w-auto"
              >
                <Avatar name={a.name} src={a.avatarUrl} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-foreground">{a.name}</span>
                  <span className="block truncate text-xs text-muted">{a.email}</span>
                </span>
                <Mail className="ml-auto size-4 shrink-0 text-muted sm:ml-1" aria-hidden />
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
