"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { NoWorkspaceNotice } from "@/components/shell/no-workspace";
import { PageBody, TopBar } from "@/components/shell/shell";
import { useAuth } from "@/lib/auth";
import { fallbackWorkspace } from "@/lib/workspace";

export default function HomePage() {
  const { me } = useAuth();
  const router = useRouter();
  const target = me ? fallbackWorkspace(me.workspaces) : null;
  useEffect(() => {
    if (target) router.replace(`/w/${target.id}/f`);
  }, [target, router]);
  if (target) return null;
  return (
    <>
      <TopBar>
        <h1 className="truncate text-base font-semibold">Luna Knowledge</h1>
      </TopBar>
      <PageBody>
        <NoWorkspaceNotice />
        <div>
          <Link href="/shared" className="inline-flex min-h-10 items-center rounded-xl border border-border-strong bg-surface px-4 text-sm font-medium hover:bg-button-hover">
            Mở Được chia sẻ
          </Link>
        </div>
      </PageBody>
    </>
  );
}
