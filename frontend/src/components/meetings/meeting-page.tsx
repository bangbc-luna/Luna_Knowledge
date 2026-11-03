"use client";

import { CalendarX2, Clock, Users } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { getMeeting, joinMeeting } from "@/lib/meetings";
import type { MeetingDetail, MeetingJoin } from "@/lib/meetings";
import { useApi } from "@/lib/use-api";
import { PageBody, TopBar } from "../shell/shell";
import { Avatar, Badge, Breadcrumb, Card, ErrorBanner, SkeletonRows } from "../ui/misc";
import { useToast } from "../ui/toast";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { dateOf, timeOf } from "./meeting-time";
import { meetingErrorText } from "./meeting-errors";
import { ManageActions } from "./meeting-manage";
import { MeetingRoom } from "./meeting-room";
import { MinutesPanel } from "./minutes-panel";
import { AI_NOTICE, PreJoin } from "./pre-join";
import type { JoinChoices } from "./pre-join";

interface Entered {
  join: MeetingJoin;
  choices: JoinChoices;
}

function durationText(from: string, to: string) {
  const minutes = Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60_000));
  if (minutes < 60) return `${minutes} phút`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} giờ ${m} phút` : `${h} giờ`;
}

function mergeAttendees(list: MeetingDetail["attendees"]): MeetingDetail["attendees"] {
  const byUser = new Map<string, MeetingDetail["attendees"][number]>();
  for (const a of list) {
    const cur = byUser.get(a.id);
    if (!cur) {
      byUser.set(a.id, a);
      continue;
    }
    byUser.set(a.id, {
      ...cur,
      joinedAt: a.joinedAt < cur.joinedAt ? a.joinedAt : cur.joinedAt,
      leftAt: cur.leftAt === null || a.leftAt === null ? null : a.leftAt > cur.leftAt ? a.leftAt : cur.leftAt,
    });
  }
  return [...byUser.values()];
}

function EndedBlock({ wsId, meeting }: { wsId: string; meeting: MeetingDetail }) {
  const start = meeting.startedAt ?? meeting.scheduledAt;
  const end = meeting.endedAt;
  const attendees = mergeAttendees(meeting.attendees);
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="min-w-0 text-lg font-semibold text-balance [overflow-wrap:anywhere]">{meeting.title}</h1>
          <Badge>Đã kết thúc</Badge>
        </div>
        <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted">Thời gian</dt>
            <dd className="mt-0.5 tabular-nums">{start ? `${timeOf(start)}${end ? `–${timeOf(end)}` : ""} · ${dateOf(start)}` : "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Thời lượng</dt>
            <dd className="mt-0.5 inline-flex items-center gap-1.5">
              <Clock className="size-3.5 text-muted" aria-hidden />
              {start && end ? durationText(start, end) : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Chủ trì</dt>
            <dd className="mt-0.5 truncate">{meeting.createdBy.name}</dd>
          </div>
        </dl>
        <section aria-labelledby="meeting-attendees" className="mt-5">
          <h2 id="meeting-attendees" className="flex items-center gap-2 text-sm font-semibold">
            <Users className="size-4 text-muted" aria-hidden />
            Người tham dự
            <span className="text-xs font-normal tabular-nums text-muted">{formatNumber(attendees.length)}</span>
          </h2>
          {attendees.length ? (
            <ul className="mt-2 grid gap-x-4 sm:grid-cols-2">
              {attendees.map((a) => (
                <li key={a.id} className="flex min-h-11 items-center gap-2.5">
                  <Avatar name={a.name} src={a.avatarUrl} />
                  <span className="min-w-0 flex-1 truncate text-sm" title={a.email}>
                    {a.name}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted">
                    {timeOf(a.joinedAt)}
                    {a.leftAt ? `–${timeOf(a.leftAt)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted">Không có ai tham dự.</p>
          )}
        </section>
      </Card>
      <MinutesPanel wsId={wsId} meetingId={meeting.id} />
    </div>
  );
}

function CancelledBlock({ wsId }: { wsId: string }) {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <Card className="flex flex-col items-center gap-3 px-4 py-12 text-center">
        <CalendarX2 className="size-6 text-muted" aria-hidden />
        <h1 className="text-lg font-semibold">Buổi họp đã bị huỷ</h1>
        <p className="text-sm text-muted text-pretty">Chủ trì đã huỷ buổi họp này nên không thể vào phòng.</p>
        <Link href={`/w/${wsId}/meetings`} className="inline-flex min-h-10 items-center rounded-xl border border-border-strong bg-surface px-4 text-sm font-medium hover:bg-button-hover">
          Về danh sách cuộc họp
        </Link>
      </Card>
    </div>
  );
}

export function MeetingPage() {
  const { wsId, meetingId } = useParams<{ wsId: string; meetingId: string }>();
  const toast = useToast();
  const meeting = useApi(() => getMeeting(meetingId), [meetingId]);
  const [entered, setEntered] = useState<Entered | null>(null);
  const [pending, setPending] = useState<Entered | null>(null);
  const [confirming, setConfirming] = useState<JoinChoices | null>(null);
  const [joining, setJoining] = useState(false);
  const data = meeting.data;
  const lobby = !entered && (data?.status === "SCHEDULED" || data?.status === "LIVE");
  const reload = meeting.reload;

  useEffect(() => {
    if (!lobby) return;
    const refresh = () => void reload();
    const id = setInterval(refresh, 15_000);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", refresh);
    };
  }, [lobby, reload]);

  const startJoin = async (choices: JoinChoices) => {
    setJoining(true);
    try {
      const join = await joinMeeting(meetingId);
      if (join.aiNotesEnabled && !choices.aiNoticeShown) setPending({ join, choices });
      else setEntered({ join, choices });
      void meeting.reload();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) void meeting.reload();
      toast("error", meetingErrorText(err));
    } finally {
      setJoining(false);
    }
  };

  const handleJoin = (choices: JoinChoices) => {
    if (data?.aiNotesEnabled) setConfirming(choices);
    else void startJoin(choices);
  };

  const leave = () => {
    setEntered(null);
    void meeting.reload();
  };

  if (entered && data) {
    return <MeetingRoom meeting={data} join={entered.join} choices={entered.choices} onLeft={leave} onEnded={leave} />;
  }

  return (
    <>
      <Dialog
        open={!!confirming}
        onClose={() => setConfirming(null)}
        title="Cuộc họp đang được AI ghi biên bản"
        description={AI_NOTICE}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(null)}>
              Huỷ
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                const choices = confirming;
                setConfirming(null);
                if (choices) void startJoin({ ...choices, aiNoticeShown: true });
              }}
            >
              Tôi đã hiểu, vào phòng
            </Button>
          </>
        }
      />
      <Dialog
        open={!!pending}
        onClose={() => setPending(null)}
        title="Cuộc họp đang được AI ghi biên bản"
        description={AI_NOTICE}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPending(null)}>
              Huỷ
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setEntered(pending);
                setPending(null);
              }}
            >
              Tôi đã hiểu, vào phòng
            </Button>
          </>
        }
      />
      <TopBar>
        <div className="hidden sm:block">
          <Breadcrumb items={[{ label: "Cuộc họp", href: `/w/${wsId}/meetings` }, ...(data ? [{ label: data.title, href: `/w/${wsId}/meetings/${meetingId}` }] : [])]} />
        </div>
        <div className="sm:hidden">
          <Breadcrumb items={[{ label: "Cuộc họp", href: `/w/${wsId}/meetings` }]} />
        </div>
      </TopBar>
      <PageBody>
        {meeting.error && !data ? (
          <ErrorBanner error={meeting.error} what="buổi họp" onRetry={() => void meeting.reload()} />
        ) : !data ? (
          <div className="border-y border-border" aria-busy="true">
            <SkeletonRows rows={3} />
          </div>
        ) : data.status === "ENDED" ? (
          <EndedBlock wsId={wsId} meeting={data} />
        ) : data.status === "CANCELLED" ? (
          <CancelledBlock wsId={wsId} />
        ) : (
          <>
            {data.canManage && data.status === "SCHEDULED" ? <ManageActions meeting={data} onChanged={() => void meeting.reload()} onCancelled={() => void meeting.reload()} /> : null}
            <PreJoin meeting={data} onJoin={handleJoin} joining={joining} />
          </>
        )}
      </PageBody>
    </>
  );
}

