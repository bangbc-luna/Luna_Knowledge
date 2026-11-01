"use client";

import { usePreviewTracks } from "@livekit/components-react";
import { LocalVideoTrack, Track } from "livekit-client";
import { Mic, MicOff, Sparkles, Users, Video, VideoOff } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { formatNumber, initials } from "@/lib/format";
import type { MeetingDetail } from "@/lib/meetings";
import { Button } from "../ui/button";
import { Select } from "../ui/select";
import { Badge, Card } from "../ui/misc";
import { ControlButton } from "./room-controls";
import { dateOf, timeOf } from "./meeting-time";

export interface JoinChoices {
  audioEnabled: boolean;
  videoEnabled: boolean;
  audioDeviceId?: string;
  videoDeviceId?: string;
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

export function PreJoin({ meeting, onJoin, joining = false }: { meeting: MeetingDetail; onJoin: (choices: JoinChoices) => void; joining?: boolean }) {
  const [audioOn, setAudioOn] = useState(true);
  const [videoOn, setVideoOn] = useState(true);
  const [audioDeviceId, setAudioDeviceId] = useState<string>();
  const [videoDeviceId, setVideoDeviceId] = useState<string>();
  const [problem, setProblem] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const constraints = useMemo(
    () => ({
      audio: audioOn ? (audioDeviceId ? { deviceId: audioDeviceId } : true) : false,
      video: videoOn ? (videoDeviceId ? { deviceId: videoDeviceId } : true) : false,
    }),
    [audioOn, videoOn, audioDeviceId, videoDeviceId],
  );
  const onError = useCallback(() => {
    setProblem("Không truy cập được mic hoặc camera. Bạn vẫn vào phòng được với mic và camera đang tắt.");
    setAudioOn(false);
    setVideoOn(false);
  }, []);
  const tracks = usePreviewTracks(constraints, onError);
  const videoTrack = tracks?.find((t): t is LocalVideoTrack => t.kind === Track.Kind.Video);
  const audioDevices = useDevices("audioinput", tracks);
  const videoDevices = useDevices("videoinput", tracks);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !videoTrack) return;
    videoTrack.attach(el);
    return () => {
      videoTrack.detach(el);
    };
  }, [videoTrack]);

  const { me: user } = useAuth();
  const host = meeting.createdBy.name;
  const when = meeting.status === "LIVE" ? <Badge tone="ok">Đang họp</Badge> : meeting.scheduledAt ? <span className="text-sm text-muted">{`${timeOf(meeting.scheduledAt)} · ${dateOf(meeting.scheduledAt)}`}</span> : null;

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-6">
      <div className="min-w-0">
        <div className="relative aspect-video overflow-hidden rounded-2xl bg-rail">
          {videoOn && videoTrack ? (
            <video ref={videoRef} muted playsInline aria-label="Xem trước camera" className="size-full -scale-x-100 object-cover" />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-rail-foreground">
              <span aria-hidden className="inline-flex size-20 items-center justify-center rounded-full bg-rail-item text-2xl font-semibold">
                {initials(user?.name ?? host)}
              </span>
              <p className="px-4 text-center text-sm text-rail-foreground/70">{videoOn ? "Đang bật camera…" : "Camera đang tắt"}</p>
            </div>
          )}
          <div className="absolute inset-x-0 bottom-3 flex justify-center gap-3">
            <ControlButton icon={audioOn ? Mic : MicOff} label={audioOn ? "Tắt mic" : "Bật mic"} active={audioOn} onClick={() => setAudioOn((v) => !v)} />
            <ControlButton icon={videoOn ? Video : VideoOff} label={videoOn ? "Tắt camera" : "Bật camera"} active={videoOn} onClick={() => setVideoOn((v) => !v)} />
          </div>
        </div>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
          <DevicePicker id="prejoin-mic" label="Micro" devices={audioDevices} value={audioDeviceId} onChange={setAudioDeviceId} fallback="Micro" />
          <DevicePicker id="prejoin-cam" label="Camera" devices={videoDevices} value={videoDeviceId} onChange={setVideoDeviceId} fallback="Camera" />
        </div>
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
        {meeting.aiNotesEnabled ? (
          <div className="flex gap-3 rounded-xl bg-warn-bg p-3 text-sm text-warn">
            <Sparkles className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p className="min-w-0 text-pretty">{AI_NOTICE}</p>
          </div>
        ) : null}
        <Button
          variant="primary"
          size="touch"
          icon={Video}
          loading={joining}
          onClick={() => onJoin({ audioEnabled: audioOn, videoEnabled: videoOn, audioDeviceId, videoDeviceId, aiNoticeShown: meeting.aiNotesEnabled })}
        >
          Vào phòng
        </Button>
      </Card>
    </div>
  );
}
