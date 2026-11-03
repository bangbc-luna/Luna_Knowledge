"use client";

import { usePreviewTracks, useTrackVolume } from "@livekit/components-react";
import { Track } from "livekit-client";
import type { LocalAudioTrack } from "livekit-client";
import { LogIn, Mic, MicOff, Sparkles, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { formatNumber } from "@/lib/format";
import type { MeetingDetail } from "@/lib/meetings";
import { Button } from "../ui/button";
import { Select } from "../ui/select";
import { Avatar, Badge, Card } from "../ui/misc";
import { ControlButton } from "./room-controls";
import { dateOf, dayKeyOf, timeOf } from "./meeting-time";

export interface JoinChoices {
  audioEnabled: boolean;
  audioDeviceId?: string;
  aiNoticeShown: boolean;
}

export const AI_NOTICE = "Cuộc họp này đang được AI ghi biên bản. Âm thanh của bạn sẽ được chép lời để viết biên bản và bị xoá sau khi có biên bản.";

function useDevices(kind: MediaDeviceKind, refreshKey: unknown) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => {
      navigator.mediaDevices
        ?.enumerateDevices()
        .then((list) => alive && setDevices(list.filter((d) => d.kind === kind && d.deviceId)))
        .catch(() => alive && setDevices([]));
    };
    load();
    navigator.mediaDevices?.addEventListener("devicechange", load);
    return () => {
      alive = false;
      navigator.mediaDevices?.removeEventListener("devicechange", load);
    };
  }, [kind, refreshKey]);
  return devices;
}

function DevicePicker({ id, label, devices, value, onChange, fallback }: { id: string; label: string; devices: MediaDeviceInfo[]; value?: string; onChange: (id: string) => void; fallback: string }) {
  const options = devices.map((d, i) => ({ value: d.deviceId, label: d.label || `${fallback} ${i + 1}` }));
  return (
    <div className="min-w-0 flex-1">
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-muted">
        {label}
      </label>
      {options.length ? (
        <Select id={id} value={value ?? options[0].value} options={options} onChange={onChange} className="min-w-0" />
      ) : (
        <p className="flex h-11 items-center rounded-xl border border-border-strong bg-surface px-4 text-sm text-muted md:h-10">Chưa thấy thiết bị</p>
      )}
    </div>
  );
}

function MicMeter({ track, enabled }: { track?: LocalAudioTrack; enabled: boolean }) {
  const volume = useTrackVolume(enabled ? track : undefined);
  const pct = enabled && track ? Math.min(100, Math.round(volume * 300)) : 0;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-muted">
        <span id="prejoin-meter-label">Thử mic</span>
        <span>{enabled ? (track ? "Nói thử, thanh bên dưới sẽ chạy" : "Đang mở mic…") : "Mic đang tắt"}</span>
      </div>
      <div role="progressbar" aria-labelledby="prejoin-meter-label" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-2 overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full bg-ok transition-[width] duration-100 motion-reduce:transition-none" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function PreJoin({ meeting, onJoin, joining = false }: { meeting: MeetingDetail; onJoin: (choices: JoinChoices) => void; joining?: boolean }) {
  const [audioOn, setAudioOn] = useState(true);
  const [audioDeviceId, setAudioDeviceId] = useState<string>();
  const [problem, setProblem] = useState<string | null>(null);

  const constraints = useMemo(() => ({ audio: audioOn ? (audioDeviceId ? { deviceId: audioDeviceId } : true) : false, video: false as const }), [audioOn, audioDeviceId]);
  const onError = useCallback(() => {
    setProblem("Không truy cập được mic. Bạn vẫn vào phòng được với mic đang tắt.");
    setAudioOn(false);
  }, []);
  const tracks = usePreviewTracks(constraints, onError);
  const audioTrack = tracks?.find((t): t is LocalAudioTrack => t.kind === Track.Kind.Audio);
  const audioDevices = useDevices("audioinput", tracks);

  const opensMs = !meeting.canManage && meeting.opensAt ? new Date(meeting.opensAt).getTime() : null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (opensMs === null) return;
    const wait = opensMs - Date.now();
    if (wait <= 0) return;
    const id = setTimeout(() => setNow(Date.now()), Math.min(wait + 50, 2_000_000_000));
    return () => clearTimeout(id);
  }, [opensMs, now]);
  const locked = opensMs !== null && opensMs > now;

  const { me: user } = useAuth();
  const host = meeting.createdBy.name;
  const when = meeting.status === "LIVE" ? <Badge tone="ok">Đang họp</Badge> : meeting.scheduledAt ? <span className="text-sm text-muted">{`${timeOf(meeting.scheduledAt)} · ${dateOf(meeting.scheduledAt)}`}</span> : null;

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-6">
      <div className="min-w-0">
        <Card className="flex flex-col gap-4 p-5">
          <div className="flex items-center gap-3">
            <Avatar name={user?.name ?? host} size="size-12" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{user?.name ?? host}</p>
              <p className="text-xs text-muted">Họp bằng âm thanh, chia sẻ màn hình và chat</p>
            </div>
            <ControlButton icon={audioOn ? Mic : MicOff} label={audioOn ? "Tắt mic" : "Bật mic"} active={audioOn} onClick={() => setAudioOn((v) => !v)} />
          </div>
          <DevicePicker id="prejoin-mic" label="Micro" devices={audioDevices} value={audioDeviceId} onChange={setAudioDeviceId} fallback="Micro" />
          <MicMeter track={audioTrack} enabled={audioOn} />
        </Card>
        {problem ? (
          <p role="alert" className="mt-3 text-sm text-err">
            {problem}
          </p>
        ) : null}
      </div>
      <Card className="flex h-fit min-w-0 flex-col gap-4 p-5">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-balance [overflow-wrap:anywhere]">{meeting.title}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
            {when}
            <span className="min-w-0 truncate">Chủ trì: {host}</span>
            {meeting.attendeeCount > 0 ? (
              <span className="inline-flex items-center gap-1">
                <Users className="size-3.5" aria-hidden />
                {formatNumber(meeting.attendeeCount)}
                <span className="sr-only"> người đã tham gia</span>
              </span>
            ) : null}
          </div>
        </div>
        {meeting.aiNotesEnabled && meeting.aiNotesAvailable ? (
          <div className="flex gap-3 rounded-xl bg-warn-bg p-3 text-sm text-warn">
            <Sparkles className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p className="min-w-0 text-pretty">{AI_NOTICE}</p>
          </div>
        ) : null}
        <Button
          variant="primary"
          size="touch"
          icon={LogIn}
          loading={joining}
          disabled={locked}
          onClick={() => onJoin({ audioEnabled: audioOn, audioDeviceId, aiNoticeShown: false })}
        >
          Vào phòng
        </Button>
        {locked && meeting.opensAt ? (
          <p role="status" className="-mt-2 text-sm text-muted">
            Phòng mở lúc {timeOf(meeting.opensAt)}
            {dayKeyOf(new Date(meeting.opensAt)) === dayKeyOf(new Date(now)) ? "" : ` · ${dateOf(meeting.opensAt)}`}
          </p>
        ) : null}
      </Card>
    </div>
  );
}
