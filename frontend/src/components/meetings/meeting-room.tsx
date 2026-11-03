"use client";

import { LiveKitRoom, RoomAudioRenderer, useConnectionState, useLocalParticipant, useParticipantAttributes, useParticipants, useRoomContext } from "@livekit/components-react";
import { ConnectionError, ConnectionErrorReason, ConnectionState, DisconnectReason, RoomEvent, ScreenSharePresets } from "livekit-client";
import type { RoomOptions } from "livekit-client";
import { LoaderCircle, Users } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ApiError } from "@/lib/api";
import { meetingErrorText } from "./meeting-errors";
import { endMeeting, getMeeting, joinMeeting, setAiNotes, setHandRaised } from "@/lib/meetings";
import type { MeetingDetail, MeetingJoin } from "@/lib/meetings";
import { useToast } from "../ui/toast";
import { useAuth } from "@/lib/auth";
import { acceptAiNotes, aiNotesFromMetadata, aiNotesFromPacket } from "@/lib/ai-notes-state";
import type { AiNotesState, AiNotesUpdate } from "@/lib/ai-notes-state";
import { dedupeParticipants } from "./participants";
import { ReactionsContext, useReactions } from "./reactions";
import { RoomControls } from "./room-controls";
import { RoomSidePanel, useMeetingChat } from "./room-side-panel";
import type { PanelTab } from "./room-side-panel";
import { RoomStage } from "./room-stage";

export const ROOM_OPTIONS: RoomOptions = {
  adaptiveStream: true,
  dynacast: true,
  publishDefaults: {
    screenShareEncoding: ScreenSharePresets.h1080fps15.encoding,
  },
};

export interface RoomChoices {
  audioEnabled: boolean;
  audioDeviceId?: string;
}

const MAX_REJOINS = 3;
const MAX_TOTAL_REJOINS = 8;
const STABLE_MS = 10_000;
const MEETING_TOPIC = "luna.meeting";

function useAiNotes(initial: AiNotesState) {
  const room = useRoomContext();
  const [state, setState] = useState(initial);
  const apply = useCallback((incoming: AiNotesUpdate) => setState((current) => acceptAiNotes(current, incoming)), []);
  useEffect(() => {
    const fromMetadata = (raw?: string) => {
      const incoming = aiNotesFromMetadata(raw);
      if (incoming) apply(incoming);
    };
    const fromData = (payload: Uint8Array, participant?: unknown, _kind?: unknown, topic?: string) => {
      if (topic !== MEETING_TOPIC || participant) return;
      const incoming = aiNotesFromPacket(payload);
      if (incoming) apply(incoming);
    };
    const fromRoom = () => fromMetadata(room.metadata);
    fromRoom();
    room.on(RoomEvent.RoomMetadataChanged, fromMetadata);
    room.on(RoomEvent.Connected, fromRoom);
    room.on(RoomEvent.Reconnected, fromRoom);
    room.on(RoomEvent.DataReceived, fromData);
    return () => {
      room.off(RoomEvent.RoomMetadataChanged, fromMetadata);
      room.off(RoomEvent.Connected, fromRoom);
      room.off(RoomEvent.Reconnected, fromRoom);
      room.off(RoomEvent.DataReceived, fromData);
    };
  }, [room, apply]);
  return [state.enabled, apply] as const;
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
  const participants = dedupeParticipants(useParticipants().filter((p) => !p.permissions?.hidden));
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

function RoomView({ meeting, join, onEnded, onMedia }: { meeting: MeetingDetail; join: MeetingJoin; onEnded: () => void; onMedia: (audio: boolean) => void }) {
  const toast = useToast();
  const state = useConnectionState();
  const { isMicrophoneEnabled } = useLocalParticipant();
  useEffect(() => {
    if (state === ConnectionState.Connected) onMedia(isMicrophoneEnabled);
  }, [state, isMicrophoneEnabled, onMedia]);
  const [aiOn, setAiOn] = useAiNotes({ enabled: join.aiNotesEnabled, version: join.aiNotesVersion });
  const { me } = useAuth();
  const { localParticipant } = useLocalParticipant();
  const { attributes } = useParticipantAttributes({ participant: localParticipant });
  const handRaised = attributes?.handRaised === "true";
  const reactions = useReactions();
  const [panelOpen, setPanelOpen] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches);
  const [tab, setTab] = useState<PanelTab>("chat");
  const chat = useMeetingChat(meeting.id, me?.id ?? "", panelOpen && tab === "chat");
  const { markRead } = chat;
  const changeTab = (next: PanelTab) => {
    setTab(next);
    if (next === "chat") markRead();
  };
  const [desktop, setDesktop] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const on = () => setDesktop(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const toggleWrap = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(panelOpen);
  useEffect(() => {
    if (wasOpen.current && !panelOpen && !desktop) toggleWrap.current?.querySelector("button")?.focus();
    wasOpen.current = panelOpen;
  }, [panelOpen, desktop]);
  const togglePanel = () => {
    if (!panelOpen && tab === "chat") markRead();
    setPanelOpen(!panelOpen);
  };

  const toggleHand = () => {
    setHandRaised(meeting.id, !handRaised).catch((err: unknown) => {
      if (err instanceof ApiError && err.status === 409) toast("error", "Chưa giơ tay được. Hãy chờ kết nối vào phòng xong rồi thử lại.");
      else if (err instanceof ApiError && err.status === 503) toast("error", "Chưa đổi được trạng thái giơ tay. Dịch vụ phòng họp đang bận, thử lại sau ít giây.");
      else toast("error", `Không đổi được trạng thái giơ tay. ${meetingErrorText(err)}`);
    });
  };

  const toggleAi = async () => {
    try {
      const result = await setAiNotes(meeting.id, !aiOn);
      setAiOn({ enabled: result.aiNotesEnabled, version: result.aiNotesVersion });
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        await getMeeting(meeting.id)
          .then((fresh) => setAiOn({ enabled: fresh.aiNotesEnabled, version: fresh.aiNotesVersion }))
          .catch(() => undefined);
        toast("error", "Chưa cập nhật được ghi biên bản AI cho phòng họp. Bấm lại công tắc để thử lại.");
      } else toast("error", meetingErrorText(err));
    }
  };

  const end = async () => {
    try {
      await endMeeting(meeting.id);
      onEnded();
    } catch (err) {
      toast("error", meetingErrorText(err));
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
      <ReactionsContext.Provider value={reactions.active}>
        <div className="relative flex min-h-0 flex-1">
          <div className="flex min-h-0 min-w-0 flex-1" inert={panelOpen && !desktop}>
            <RoomStage />
          </div>
          <RoomSidePanel open={panelOpen} tab={tab} onTab={changeTab} onClose={() => setPanelOpen(false)} chat={chat} meetingId={meeting.id} meId={me?.id ?? ""} isHost={join.isHost} />
        </div>
      </ReactionsContext.Provider>
      <RoomControls isHost={join.isHost} aiOn={aiOn} aiAvailable={meeting.aiNotesAvailable} onToggleAi={toggleAi} onEnd={end} onReact={reactions.send} handRaised={handRaised} onToggleHand={toggleHand} panelWrapRef={toggleWrap} panel={{ open: panelOpen, unread: chat.unread, onToggle: togglePanel }} />
      <RoomAudioRenderer />
    </div>
  );
}

export function MeetingRoom({ meeting, join, choices, onLeft, onEnded }: { meeting: MeetingDetail; join: MeetingJoin; choices: RoomChoices; onLeft: () => void; onEnded: () => void }) {
  const toast = useToast();
  const [session, setSession] = useState<{ join: MeetingJoin; gen: number; audio: boolean | { deviceId: string }}>({ join, gen: 0, audio: choices.audioEnabled ? (choices.audioDeviceId ? { deviceId: choices.audioDeviceId } : true) : false });
  const genRef = useRef(0);
  const attempts = useRef(0);
  const total = useRef(0);
  const rejoining = useRef(false);
  const lastMedia = useRef(choices);
  const aliveRef = useRef(true);
  const cancelSleep = useRef<(() => void) | null>(null);
  const stableTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const roomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    aliveRef.current = true;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const room = roomRef.current;
    const inerted: Element[] = [];
    for (const el of Array.from(document.body.children)) {
      if (el === room || el.hasAttribute("aria-live") || el.hasAttribute("inert") || /^(SCRIPT|STYLE|LINK|NEXT-ROUTE-ANNOUNCER)$/.test(el.tagName)) continue;
      el.setAttribute("inert", "");
      inerted.push(el);
    }
    room?.focus();
    return () => {
      aliveRef.current = false;
      cancelSleep.current?.();
      if (stableTimer.current) clearTimeout(stableTimer.current);
      for (const el of inerted) el.removeAttribute("inert");
      document.body.style.overflow = prev;
    };
  }, []);

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const id = setTimeout(resolve, ms);
      cancelSleep.current = () => {
        clearTimeout(id);
        resolve();
      };
    });

  const rejoin = async (gen: number) => {
    if (gen !== genRef.current || rejoining.current) return;
    rejoining.current = true;
    try {
      while (aliveRef.current) {
        if (attempts.current >= MAX_REJOINS || total.current >= MAX_TOTAL_REJOINS) {
          toast("error", "Mất kết nối với phòng họp. Hãy vào lại phòng.");
          onEnded();
          return;
        }
        attempts.current += 1;
        total.current += 1;
        await sleep(attempts.current * 1000);
        if (!aliveRef.current) return;
        try {
          const next = await joinMeeting(meeting.id);
          if (!aliveRef.current) return;
          genRef.current += 1;
          const media = lastMedia.current;
          setSession({
            join: next,
            gen: genRef.current,
            audio: media.audioEnabled ? (media.audioDeviceId ? { deviceId: media.audioDeviceId } : true) : false,
          });
          return;
        } catch (err) {
          if (!aliveRef.current) return;
          if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
            onEnded();
            return;
          }
        }
      }
    } finally {
      rejoining.current = false;
    }
  };

  const onMedia = useCallback((audioEnabled: boolean) => {
    lastMedia.current = { ...lastMedia.current, audioEnabled };
  }, []);

  const gen = session.gen;
  const handleDisconnected = (reason?: DisconnectReason) => {
    if (gen !== genRef.current) return;
    if (stableTimer.current) clearTimeout(stableTimer.current);
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
    <div ref={roomRef} tabIndex={-1} className="luna-room fixed inset-0 z-45 outline-hidden">
      <LiveKitRoom
        key={session.gen}
        serverUrl={session.join.serverUrl}
        token={session.join.token}
        connect
        audio={session.audio}
        video={false}
        options={ROOM_OPTIONS}
        onConnected={() => {
          if (stableTimer.current) clearTimeout(stableTimer.current);
          stableTimer.current = setTimeout(() => {
            attempts.current = 0;
          }, STABLE_MS);
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
