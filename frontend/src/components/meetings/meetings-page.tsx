"use client";

import { CalendarPlus, Users, Video } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { meetingErrorText } from "./meeting-errors";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
import { listMeetings, meetingHref } from "@/lib/meetings";
import type {
  MeetingList,
  MeetingSummary,
  MinutesStatus,
} from "@/lib/meetings";
import { useApi } from "@/lib/use-api";
import { PageBody, TopBar } from "../shell/shell";
import { Button } from "../ui/button";
import { focusRing } from "../ui/focus";
import type { BadgeTone } from "../ui/misc";
import { Badge, EmptyState, ErrorBanner, SkeletonRows } from "../ui/misc";
import { useToast } from "../ui/toast";
import { CreateMeetingDialog } from "./create-meeting-dialog";
import type { MeetingMode } from "./create-meeting-dialog";
import { dateOf, groupByDay, timeOf } from "./meeting-time";

const PAGE = 20;

const MINUTES_BADGE: Partial<
  Record<MinutesStatus, { label: string; tone: BadgeTone }>
> = {
  RECORDING: { label: "Đang xử lý", tone: "neutral" },
  PROCESSING: { label: "Đang xử lý", tone: "neutral" },
  PUBLISHING: { label: "Đang xử lý", tone: "neutral" },
  AWAITING_REVIEW: { label: "Chờ duyệt", tone: "warn" },
  PUBLISHED: { label: "Đã có biên bản", tone: "ok" },
  FAILED: { label: "Lỗi biên bản", tone: "err" },
};

const anchorOf = (m: MeetingSummary) =>
  m.status === "ENDED" ? (m.endedAt ?? m.scheduledAt) : m.scheduledAt;

function MeetingRow({
  wsId,
  m,
  live,
}: {
  wsId: string;
  m: MeetingSummary;
  live?: boolean;
}) {
  const href = meetingHref(wsId, m.id);
  const at = anchorOf(m);
  const minutesBadge =
    m.status === "ENDED"
      ? m.minutes
        ? MINUTES_BADGE[m.minutes.status]
        : undefined
      : undefined;
  return (
    <li className="relative flex items-center gap-3 border-t border-border px-1 py-2.5 first:border-t-0 hover:bg-surface-hover sm:px-3">
      <div className="w-16 shrink-0 text-sm tabular-nums text-muted sm:w-24">
        {live ? (
          <Badge tone="ok">Đang họp</Badge>
        ) : at ? (
          <>
            <span className="font-medium text-foreground">{timeOf(at)}</span>
            {m.status === "ENDED" ? (
              <span className="block text-xs">{dateOf(at)}</span>
            ) : null}
          </>
        ) : (
          "—"
        )}
      </div>
      <div className="min-w-0 flex-1">
        <Link
          href={href}
          className={cn(
            "block truncate rounded text-sm font-medium after:absolute after:inset-0",
            focusRing,
          )}
          title={m.title}
        >
          {m.title}
        </Link>
        <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted">
          <span className="sr-only">Chủ trì: </span>
          <span className="min-w-8 truncate">{m.createdBy.name}</span>
          {m.status === "LIVE" && m.startedAt ? (
            <span className="hidden shrink-0 sm:inline">
              · Bắt đầu {timeOf(m.startedAt)}
            </span>
          ) : null}
          {m.attendeeCount > 0 ? (
            <span className="inline-flex shrink-0 items-center gap-1">
              · <Users className="size-3" aria-hidden />
              {formatNumber(m.attendeeCount)}
              <span className="sr-only"> người tham gia</span>
            </span>
          ) : null}
        </p>
      </div>
      {minutesBadge ? (
        <Badge tone={minutesBadge.tone} small className="relative">
          {minutesBadge.label}
        </Badge>
      ) : null}
      {live ? (
        <Link
          href={href}
          className={cn(
            "relative z-10 inline-flex min-h-9 shrink-0 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-hover",
            focusRing,
          )}
        >
          <Video className="size-4" aria-hidden />
          Vào phòng
        </Link>
      ) : null}
    </li>
  );
}

function Section({
  id,
  title,
  count,
  children,
}: {
  id: string;
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="min-w-0">
      <h2
        id={id}
        className="mb-2 flex items-center gap-2 px-1 text-sm font-semibold sm:px-3"
      >
        {title}
        {count !== undefined ? (
          <span className="text-xs font-normal tabular-nums text-muted">
            {count}
          </span>
        ) : null}
      </h2>
      {children}
    </section>
  );
}

type PagedList = {
  items: MeetingSummary[];
  cursor: string | null;
  loading: boolean;
  loadMore: () => Promise<void>;
};

const NO_ITEMS: MeetingSummary[] = [];

function usePagedList(
  wsId: string,
  scope: "live" | "upcoming" | "past",
  base: MeetingList | null | undefined,
  limit: number,
): PagedList {
  const toast = useToast();
  const [extra, setExtra] = useState<{
    base: MeetingList | null | undefined;
    items: MeetingSummary[];
    cursor: string | null;
  }>({ base: null, items: [], cursor: null });
  const [loading, setLoading] = useState(false);
  const current = useMemo(
    () =>
      extra.base === base
        ? extra
        : { base, items: NO_ITEMS, cursor: base?.nextCursor ?? null },
    [extra, base],
  );
  const items = useMemo(
    () => [...(base?.items ?? []), ...current.items],
    [base, current.items],
  );
  const loadMore = async () => {
    if (!current.cursor) return;
    setLoading(true);
    try {
      const page = await listMeetings(wsId, scope, current.cursor, limit);
      setExtra({
        base,
        items: [...current.items, ...page.items],
        cursor: page.nextCursor,
      });
    } catch (err) {
      toast("error", meetingErrorText(err));
    } finally {
      setLoading(false);
    }
  };
  return {
    items,
    cursor: current.cursor,
    loading,
    loadMore,
  };
}

function MoreButton({ list }: { list: PagedList }) {
  if (!list.cursor) return null;
  return (
    <div className="mt-2 flex justify-center">
      <Button
        loading={list.loading}
        onClick={() => void list.loadMore()}
        className="w-full sm:w-auto"
      >
        Xem thêm
      </Button>
    </div>
  );
}

export function MeetingsPage() {
  const { wsId } = useParams<{ wsId: string }>();
  const { me } = useAuth();
  const ws = me?.workspaces.find((w) => w.id === wsId);
  const canCreate = !!ws && ws.role !== "VIEWER";
  const [dialog, setDialog] = useState<MeetingMode | null>(null);
  const live = useApi(() => listMeetings(wsId, "live", undefined, 50), [wsId]);
  const upcoming = useApi(
    () => listMeetings(wsId, "upcoming", undefined, PAGE),
    [wsId],
  );
  const past = useApi(
    () => listMeetings(wsId, "past", undefined, PAGE),
    [wsId],
  );
  const liveList = usePagedList(wsId, "live", live.data, 50);
  const upcomingList = usePagedList(wsId, "upcoming", upcoming.data, PAGE);
  const pastList = usePagedList(wsId, "past", past.data, PAGE);

  const groups = useMemo(
    () => groupByDay(upcomingList.items),
    [upcomingList.items],
  );

  const reloadAll = () => {
    void live.reload();
    void upcoming.reload();
    void past.reload();
  };

  const loading = [live, upcoming, past].some((q) => q.loading && !q.data);
  const failed = [live, upcoming, past].find((q) => q.error && !q.data);
  const aiAvailable = me?.aiNotesAvailable ?? false;
  const total =
    liveList.items.length + upcomingList.items.length + pastList.items.length;

  const create = canCreate ? (
    <div className="flex w-full gap-2 sm:w-auto">
      <Button
        variant="primary"
        icon={Video}
        className="flex-1 whitespace-nowrap sm:flex-none"
        onClick={() => setDialog("instant")}
      >
        Họp ngay
      </Button>
      <Button
        icon={CalendarPlus}
        className="flex-1 whitespace-nowrap sm:flex-none"
        onClick={() => setDialog("scheduled")}
      >
        Đặt lịch
      </Button>
    </div>
  ) : null;

  return (
    <>
      <TopBar>
        <h1 className="truncate text-base font-semibold">
          Cuộc họp{ws ? ` · ${ws.name}` : ""}
        </h1>
      </TopBar>
      <PageBody>
        {create ? <div className="flex sm:justify-end">{create}</div> : null}
        {failed ? (
          <ErrorBanner
            error={failed.error}
            what="danh sách cuộc họp"
            onRetry={reloadAll}
          />
        ) : loading ? (
          <div className="border-y border-border">
            <SkeletonRows rows={5} />
          </div>
        ) : total === 0 ? (
          <EmptyState
            text={
              canCreate
                ? "Chưa có cuộc họp nào trong workspace này. Họp ngay hoặc đặt lịch để mời mọi người."
                : "Chưa có cuộc họp nào trong workspace này."
            }
            action={create}
          />
        ) : (
          <div className="flex flex-col gap-5">
            {liveList.items.length ? (
              <Section
                id="meetings-live"
                title="Đang diễn ra"
                count={liveList.items.length}
              >
                <ul className="border-y border-border">
                  {liveList.items.map((m) => (
                    <MeetingRow key={m.id} wsId={wsId} m={m} live />
                  ))}
                </ul>
                <MoreButton list={liveList} />
              </Section>
            ) : null}
            {groups.length ? (
              <Section
                id="meetings-upcoming"
                title="Sắp tới"
                count={upcomingList.items.length}
              >
                <div className="flex flex-col gap-3">
                  {groups.map((g) => (
                    <div key={g.key}>
                      <h3 className="px-1 pb-1 text-xs font-medium text-muted sm:px-3">
                        {g.label}
                      </h3>
                      <ul className="border-y border-border">
                        {g.items.map((m) => (
                          <MeetingRow key={m.id} wsId={wsId} m={m} />
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
                <MoreButton list={upcomingList} />
              </Section>
            ) : null}
            {pastList.items.length ? (
              <Section id="meetings-past" title="Đã qua">
                <ul className="border-y border-border">
                  {pastList.items.map((m) => (
                    <MeetingRow key={m.id} wsId={wsId} m={m} />
                  ))}
                </ul>
                <MoreButton list={pastList} />
              </Section>
            ) : null}
          </div>
        )}
      </PageBody>
      <CreateMeetingDialog
        wsId={wsId}
        open={dialog !== null}
        initialMode={dialog ?? "instant"}
        aiAvailable={aiAvailable}
        onClose={() => setDialog(null)}
        onCreated={reloadAll}
      />
    </>
  );
}
