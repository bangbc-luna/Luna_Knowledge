"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api, ApiError, describeError } from "@/lib/api";
import { ROLE_LABEL } from "@/lib/format";
import type { NodeItem, Share, ShareRole } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { Button, IconButton } from "../ui/button";
import { Sheet } from "../ui/dialog";
import { Input } from "../ui/input";
import { Avatar, Badge, ErrorBanner, SkeletonRows } from "../ui/misc";
import { Select } from "../ui/select";
import { useToast } from "../ui/toast";

const SHARE_ROLES = [
  { value: "VIEWER" as const, label: ROLE_LABEL.VIEWER },
  { value: "EDITOR" as const, label: ROLE_LABEL.EDITOR },
];

interface SharesResponse {
  direct: Share[];
  inherited: Array<Share & { fromNode: { id: string; name: string } }>;
}

/** Chia sẻ một mục: thêm theo email, đổi quyền, thu hồi; xem share kế thừa từ thư mục cha. */
export function ShareSheet({ node, onClose, memberEmails }: { node: NodeItem | null; onClose: () => void; memberEmails: Set<string> }) {
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ShareRole>("VIEWER");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data, loading, error: loadError, reload } = useApi(
    () => api<SharesResponse>(`/nodes/${node!.id}/shares`),
    [node?.id],
    { enabled: !!node },
  );

  const add = async () => {
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/nodes/${node!.id}/shares`, { method: "POST", body: { email: email.trim(), role } });
      setEmail("");
      toast("success", `Đã chia sẻ cho ${email.trim()}`);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError && err.code === "CONFLICT" ? "Người này đã được chia sẻ, hãy đổi quyền ở danh sách bên dưới." : describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const row = (s: Share, extra?: React.ReactNode) => (
    <li key={s.id} className="flex min-h-14 items-center gap-3 py-2">
      <Avatar name={s.user.name} src={s.user.avatarUrl} />
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <span className="min-w-0 truncate">{s.user.name}</span>
          {!memberEmails.has(s.user.email) ? <Badge small>Ngoài workspace</Badge> : null}
        </p>
        <p className="truncate text-xs text-muted">{s.user.email}</p>
      </div>
      {extra}
    </li>
  );

  return (
    <Sheet open={!!node} onClose={onClose} title={node ? `Chia sẻ «${node.name}»` : ""} subtitle="Người được chia sẻ thấy cả các mục bên trong.">
      <form
        className="flex flex-col gap-2 px-6 pt-6"
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <label htmlFor="share-email" className="text-sm font-medium">
          Chia sẻ với
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input id="share-email" type="email" placeholder="ten@lunatech.vn" value={email} onChange={(e) => setEmail(e.target.value)} invalid={!!error} className="sm:flex-1" />
          <div className="flex gap-2">
            <Select value={role} options={SHARE_ROLES} onChange={setRole} ariaLabel="Quyền" className="w-32" align="right" />
            <Button type="submit" variant="primary" loading={busy} className="min-h-11 md:min-h-10">
              Chia sẻ
            </Button>
          </div>
        </div>
        {error ? <p className="text-sm text-err-text">{error}</p> : <p className="text-xs text-muted">Quyền chỉ cộng thêm, không bớt quyền họ đang có trong workspace.</p>}
      </form>
      {loading ? (
        <div className="px-6 py-6">
          <SkeletonRows rows={3} />
        </div>
      ) : loadError ? (
        <ErrorBanner error={loadError} what="danh sách chia sẻ" onRetry={reload} />
      ) : data ? (
        <>
          <div className="px-6 pt-6">
            <h3 className="text-sm font-semibold">
              Chia sẻ trực tiếp <span className="font-normal text-muted">{data.direct.length}</span>
            </h3>
            {data.direct.length ? (
              <ul className="divide-y divide-border">
                {data.direct.map((s) =>
                  row(
                    s,
                    <>
                      <Select
                        size="inline"
                        value={s.role}
                        options={SHARE_ROLES}
                        align="right"
                        ariaLabel={`Quyền của ${s.user.name}`}
                        onChange={async (next) => {
                          try {
                            await api(`/nodes/${node!.id}/shares/${s.id}`, { method: "PATCH", body: { role: next } });
                            toast("success", `Đã đổi quyền của ${s.user.name}`);
                            await reload();
                          } catch (err) {
                            toast("error", describeError(err));
                          }
                        }}
                      />
                      <IconButton
                        icon={X}
                        label={`Thu hồi chia sẻ của ${s.user.name}`}
                        onClick={async () => {
                          try {
                            await api(`/nodes/${node!.id}/shares/${s.id}`, { method: "DELETE" });
                            toast("success", `Đã thu hồi chia sẻ của ${s.user.name}`);
                            await reload();
                          } catch (err) {
                            toast("error", describeError(err));
                          }
                        }}
                      />
                    </>,
                  ),
                )}
              </ul>
            ) : (
              <p className="py-4 text-sm text-muted">Chưa chia sẻ mục này với ai.</p>
            )}
          </div>
          {data.inherited.length ? (
            <div className="px-6 pt-5 pb-6">
              <h3 className="text-sm font-semibold">Kế thừa từ thư mục cha</h3>
              <ul className="divide-y divide-border">
                {data.inherited.map((s) =>
                  row(
                    s,
                    <span className="shrink-0 text-right text-sm text-foreground/80">
                      {ROLE_LABEL[s.role]}
                      <Link href={`/w/${node!.workspaceId}/f/${s.fromNode.id}`} className="block max-w-36 truncate text-xs text-muted underline-offset-4 hover:underline">
                        từ {s.fromNode.name}
                      </Link>
                    </span>,
                  ),
                )}
              </ul>
            </div>
          ) : (
            <div className="pb-6" />
          )}
        </>
      ) : null}
    </Sheet>
  );
}
