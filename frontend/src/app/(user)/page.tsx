"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { PageBody, TopBar } from "@/components/shell/shell";
import { Card, EmptyState } from "@/components/ui/misc";
import { useAuth } from "@/lib/auth";
import { lastWorkspace } from "@/lib/workspace";

/** Trang đầu: vào workspace dùng gần nhất; chưa thuộc workspace nào thì chỉ còn "Được chia sẻ". */
export default function HomePage() {
  const { me } = useAuth();
  const router = useRouter();
  const target = me?.workspaces.find((w) => w.id === lastWorkspace()) ?? me?.workspaces[0];
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
        <Card>
          <EmptyState
            text="Bạn chưa thuộc workspace nào. Tài liệu người khác chia sẻ cho bạn nằm ở mục Được chia sẻ."
            action={
              <Link href="/shared" className="inline-flex min-h-10 items-center rounded-xl border border-border-strong bg-surface px-4 text-sm font-medium hover:bg-button-hover">
                Mở Được chia sẻ
              </Link>
            }
          />
        </Card>
      </PageBody>
    </>
  );
}
