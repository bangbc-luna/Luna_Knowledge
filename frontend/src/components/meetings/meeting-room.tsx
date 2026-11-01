"use client";

import { LiveKitRoom, RoomAudioRenderer, useConnectionState, useLocalParticipant, useParticipants, useRoomContext } from "@livekit/components-react";
import { ConnectionError, ConnectionErrorReason, ConnectionState, DisconnectReason, RoomEvent, ScreenSharePresets, VideoPresets } from "livekit-client";
import type { RoomOptions } from "livekit-client";
import { LoaderCircle, Users } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ApiError, describeError } from "@/lib/api";
import { endMeeting, joinMeeting, setAiNotes } from "@/lib/meetings";
import type { MeetingDetail, MeetingJoin } from "@/lib/meetings";
import { useToast } from "../ui/toast";
import { RoomControls } from "./room-controls";
import { RoomStage } from "./room-stage";

export const ROOM_OPTIONS: RoomOptions = {
  adaptiveStream: true,
  dynacast: true,
  videoCaptureDefaults: { resolution: VideoPresets.h720.resolution },
  publishDefaults: {
    simulcast: true,
    videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
    screenShareEncoding: ScreenSharePresets.h1080fps15.encoding,
  },
};

export interface RoomChoices {
  audioEnabled: boolean;
  videoEnabled: boolean;
  audioDeviceId?: string;
  videoDeviceId?: string;
}

const MAX_REJOINS = 3;
const MEETING_TOPIC = "luna.meeting";

function parseJson(raw: string | Uint8Array | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function useAiNotes(initial: boolean) {
  const room = useRoomContext();
  const [on, setOn] = useState(initial);
  useEffect(() => {
    const fromMetadata = (raw?: string) => {
      const meta = parseJson(raw);
      if (typeof meta?.aiNotesEnabled === "boolean") setOn(meta.aiNotesEnabled);
    };
    const fromData = (payload: Uint8Array, participant?: unknown, _kind?: unknown, topic?: string) => {
      if (topic !== MEETING_TOPIC || participant) return;
      const msg = parseJson(payload);
      if (msg?.type === "ai_notes" && typeof msg.enabled === "boolean") setOn(msg.enabled);
    };
    fromMetadata(room.metadata);
    room.on(RoomEvent.RoomMetadataChanged, fromMetadata);
    room.on(RoomEvent.DataReceived, fromData);
    return () => {
      room.off(RoomEvent.RoomMetadataChanged, fromMetadata);
      room.off(RoomEvent.DataReceived, fromData);
    };
  }, [room]);
  return [on, setOn] as const;
}

const pad = (n: number) => String(n).padStart(2, "0");

function useElapsed(startedAt: string | null) {
  const [origin] = useState(() => (startedAt ? new Date(startedAt).getTime() : Date.now()));
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const s = Math.max(0, Math.floor((now - origin) / 1000));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

function RoomTopBar({ title, startedAt, aiOn, actions }: { title: string; startedAt: string | null; aiOn: boolean; actions?: React.ReactNode }) {
  const elapsed = useElapsed(startedAt);
  const participants = useParticipants().filter((p) => !p.permissions?.hidden);
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-rail-item px-3 py-2.5">
      <h1 className="min-w-0 flex-1 truncate text-sm font-semibold sm:flex-none sm:max-w-[40ch]" title={title}>
        {title}
      </h1>
      <span className="text-sm tabular-nums text-rail-foreground/70" aria-label="Thời gian họp">
        {elapsed}
      </span>
      {aiOn ? (
        <span role="status" className="order-last inline-flex basis-full items-center gap-1.5 text-xs font-medium text-err-line sm:order-none sm:basis-auto">
          <span aria-hidden className="size-2 shrink-0 rounded-full bg-err-line motion-safe:animate-pulse" />
          AI đang ghi biên bản
        </span>
      ) : null}
      <span className="inline-flex items-center gap-1.5 text-sm tabular-nums text-rail-foreground/70 sm:ml-auto">
        <Users className="size-4" aria-hidden />
        {participants.length}
        <span className="sr-only"> người trong phòng</span>
      </span>
      {actions}
    </header>
  );
}

function RoomView({ meeting, join, onEnded, onMedia }: { meeting: MeetingDetail; join: MeetingJoin; onEnded: () => void; onMedia: (audio: boolean, video: boolean) => void }) {
  const toast = useToast();
  const state = useConnectionState();
  const { isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  useEffect(() => {
    if (state === ConnectionState.Connected) onMedia(isMicrophoneEnabled, isCameraEnabled);
  }, [state, isMicrophoneEnabled, isCameraEnabled, onMedia]);
  const [aiOn, setAiOn] = useAiNotes(join.aiNotesEnabled);

  const toggleAi = async () => {
    try {
      const result = await setAiNotes(meeting.id, !aiOn);
      setAiOn(result.aiNotesEnabled);
    } catch (err) {
      toast(
        "error",
        err instanceof ApiError && err.status === 503
          ? "Chưa cập nhật được ghi biên bản AI cho phòng họp. Bấm lại công tắc để thử lại."
          : describeError(err),
      );
    }
  };

  const end = async () => {
    try {
      await endMeeting(meeting.id);
      onEnded();
    } catch (err) {
      toast("error", describeError(err));
    }
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <RoomTopBar title={meeting.title} startedAt={meeting.startedAt} aiOn={aiOn} />
      {state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting ? (
        <div role="status" className="absolute inset-x-0 top-14 z-10 mx-auto flex w-fit items-center gap-2 rounded-full bg-rail-item px-4 py-2 text-sm">
          <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
          Đang kết nối lại…
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1">
        <RoomStage />
      </div>
      <RoomControls isHost={join.isHost} aiOn={aiOn} onToggleAi={toggleAi} onEnd={end} />
      <RoomAudioRenderer />
    </div>
  );
}

export function MeetingRoom({ meeting, join, choices, onLeft, onEnded }: { meeting: MeetingDetail; join: MeetingJoin; choices: RoomChoices; onLeft: () => void; onEnded: () => void }) {
  const toast = useToast();
  const [session, setSession] = useState<{ join: MeetingJoin; gen: number; audio: boolean | { deviceId: string }; video: boolean | { deviceId: string } }>({ join, gen: 0, audio: choices.audioEnabled ? (choices.audioDeviceId ? { deviceId: choices.audioDeviceId } : true) : false, video: choices.videoEnabled ? (choices.videoDeviceId ? { deviceId: choices.videoDeviceId } : true) : false });
  const genRef = useRef(0);
  const attempts = useRef(0);
  const rejoining = useRef(false);
  const lastMedia = useRef(choices);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const rejoin = async (gen: number) => {
    if (gen !== genRef.current || rejoining.current) return;
    rejoining.current = true;
    try {
      if (attempts.current >= MAX_REJOINS) {
        toast("error", "Mất kết nối với phòng họp. Hãy vào lại phòng.");
        onLeft();
        return;
      }
      attempts.current += 1;
      await new Promise((resolve) => setTimeout(resolve, attempts.current * 1000));
      const next = await joinMeeting(meeting.id);
      genRef.current += 1;
      const media = lastMedia.current;
      setSession({
        join: next,
        gen: genRef.current,
        audio: media.audioEnabled ? (media.audioDeviceId ? { deviceId: media.audioDeviceId } : true) : false,
        video: media.videoEnabled ? (media.videoDeviceId ? { deviceId: media.videoDeviceId } : true) : false,
      });
    } catch (err) {
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) onEnded();
      else {
        toast("error", describeError(err));
        onLeft();
      }
    } finally {
      rejoining.current = false;
    }
  };

  const onMedia = useCallback((audioEnabled: boolean, videoEnabled: boolean) => {
    lastMedia.current = { ...lastMedia.current, audioEnabled, videoEnabled };
  }, []);

  const gen = session.gen;
  const handleDisconnected = (reason?: DisconnectReason) => {
    if (gen !== genRef.current) return;
    if (reason === DisconnectReason.CLIENT_INITIATED) onLeft();
    else if (reason === DisconnectReason.ROOM_DELETED) onEnded();
    else if (reason === DisconnectReason.DUPLICATE_IDENTITY) {
      toast("error", "Bạn đã vào phòng này ở thiết bị hoặc tab khác.");
      onLeft();
    } else if (reason === DisconnectReason.PARTICIPANT_REMOVED) {
      toast("error", "Bạn đã bị đưa ra khỏi phòng.");
      onLeft();
    } else void rejoin(gen);
  };
  const handleError = (error: Error) => {
    if (error instanceof ConnectionError && (error.reason === ConnectionErrorReason.NotAllowed || error.status === 401)) void rejoin(gen);
  };

  return createPortal(
    <div className="luna-room fixed inset-0 z-45">
      <LiveKitRoom
        key={session.gen}
        serverUrl={session.join.serverUrl}
        token={session.join.token}
        connect
        audio={session.audio}
        video={session.video}
        options={ROOM_OPTIONS}
        onConnected={() => {
          attempts.current = 0;
        }}
        onDisconnected={handleDisconnected}
        onError={handleError}
        className="h-full"
      >
        <RoomView meeting={meeting} join={session.join} onEnded={onEnded} onMedia={onMedia} />
      </LiveKitRoom>
    </div>,
    document.body,
  );
}
