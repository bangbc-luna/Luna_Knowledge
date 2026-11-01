"use client";

import { useDataChannel, useIsMuted, useParticipantAttributes, useParticipants } from "@livekit/components-react";
import type { Participant } from "livekit-client";
import { Track } from "livekit-client";
import { ArrowDown, LoaderCircle, Mic, MicOff, RotateCcw, Send, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import { meetingErrorText } from "./meeting-errors";
import { cn } from "@/lib/cn";
import { listChat, linkify, muteParticipant, sendChat } from "@/lib/meetings";
import type { MeetingChatMessage } from "@/lib/meetings";
import { focusRing } from "../ui/focus";
import { Avatar } from "../ui/misc";
import { useToast } from "../ui/toast";

const CHAT_TOPIC = "luna.chat";
const PAGE_SIZE = 100;
const MAX_PAGES = 20;
const MAX_LENGTH = 2000;

export type PanelTab = "chat" | "people";

interface PendingMessage {
  tempId: string;
  body: string;
  error: string | null;
}

function isChatMessage(value: unknown): value is MeetingChatMessage {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<MeetingChatMessage>;
  return typeof v.id === "string" && typeof v.body === "string" && typeof v.createdAt === "string" && typeof v.author === "object" && v.author !== null && typeof v.author.id === "string" && typeof v.author.name === "string";
}

function mergeMessages(prev: MeetingChatMessage[], incoming: MeetingChatMessage[]): MeetingChatMessage[] {
  const seen = new Set(prev.map((m) => m.id));
  const fresh = incoming.filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
  if (fresh.length === 0) return prev;
  return [...prev, ...fresh].sort((a, b) => (a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1));
}

function describeSendError(err: unknown): string {
  if (err instanceof ApiError && err.status === 409) return "Cuộc họp đã kết thúc, không gửi được tin nhắn.";
  if (err instanceof ApiError && err.status === 429) return "Bạn gửi quá nhanh. Thử lại sau ít giây.";
  return meetingErrorText(err);
}

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });

export function useMeetingChat(meetingId: string, meId: string, panelVisible: boolean) {
  const [messages, setMessages] = useState<MeetingChatMessage[]>([]);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const visibleRef = useRef(panelVisible);
  const seen = useRef(new Set<string>());
  const pendingRef = useRef<PendingMessage[]>([]);
  const alive = useRef(true);
  const tempCounter = useRef(0);

  useEffect(() => {
    visibleRef.current = panelVisible;
  }, [panelVisible]);

  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  const markRead = useCallback(() => setUnread(0), []);

  const load = useCallback(async () => {
    try {
      let cursor: string | undefined;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const res = await listChat(meetingId, cursor, PAGE_SIZE);
        if (!alive.current) return;
        for (const m of res.items) seen.current.add(m.id);
        setMessages((prev) => mergeMessages(prev, res.items));
        if (!res.nextCursor) break;
        if (page === MAX_PAGES - 1) setTruncated(true);
        cursor = res.nextCursor;
      }
    } catch (err) {
      if (alive.current) setLoadError(meetingErrorText(err));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [meetingId]);

  const reload = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    void load();
  }, [load]);

  useEffect(() => {
    alive.current = true;
    const timer = setTimeout(() => void load(), 0);
    return () => {
      clearTimeout(timer);
      alive.current = false;
    };
  }, [load]);

  useDataChannel(CHAT_TOPIC, (msg) => {
    if (msg.from) return;
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder().decode(msg.payload));
    } catch {
      return;
    }
    if (!isChatMessage(value)) return;
    const message = value;
    const isNew = !seen.current.has(message.id);
    seen.current.add(message.id);
    setMessages((prev) => mergeMessages(prev, [message]));
    if (isNew && !visibleRef.current && message.author.id !== meId) setUnread((n) => n + 1);
  });

  const attempt = useCallback(
    async (tempId: string, body: string) => {
      try {
        const sent = await sendChat(meetingId, body);
        if (!alive.current) return;
        seen.current.add(sent.id);
        setMessages((prev) => mergeMessages(prev, [sent]));
        setPending((list) => list.filter((p) => p.tempId !== tempId));
      } catch (err) {
        if (!alive.current) return;
        const error = describeSendError(err);
        setPending((list) => list.map((p) => (p.tempId === tempId ? { ...p, error } : p)));
      }
    },
    [meetingId],
  );

  const send = useCallback(
    (body: string) => {
      tempCounter.current += 1;
      const tempId = `pending-${tempCounter.current}`;
      setPending((list) => [...list, { tempId, body, error: null }]);
      void attempt(tempId, body);
    },
    [attempt],
  );

  const retry = useCallback(
    (tempId: string) => {
      const target = pendingRef.current.find((p) => p.tempId === tempId);
      if (!target) return;
      setPending((list) => list.map((p) => (p.tempId === tempId ? { ...p, error: null } : p)));
      void attempt(tempId, target.body);
    },
    [attempt],
  );

  const dismiss = useCallback((tempId: string) => setPending((list) => list.filter((p) => p.tempId !== tempId)), []);

  return { messages, pending, loading, loadError, reload, markRead, unread, truncated, send, retry, dismiss };
}

export type MeetingChat = ReturnType<typeof useMeetingChat>;

function MessageText({ body }: { body: string }) {
  return (
    <p className="text-sm [overflow-wrap:anywhere] whitespace-pre-wrap">
      {linkify(body).map((part, i) =>
        part.kind === "link" ? (
          <a key={i} href={part.value} target="_blank" rel="noopener noreferrer" className={cn("underline underline-offset-2", focusRing)}>
            {part.value}
          </a>
        ) : (
          <span key={i}>{part.value}</span>
        ),
      )}
    </p>
  );
}

function ChatView({ chat, meId, visible }: { chat: MeetingChat; meId: string; visible: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [behind, setBehind] = useState(false);
  const [draft, setDraft] = useState("");
  const total = chat.messages.length + chat.pending.length;
  const lastMine = chat.pending.length > 0 || chat.messages[chat.messages.length - 1]?.author.id === meId;

  const toBottom = () => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
    atBottom.current = true;
    setBehind(false);
  };

  useLayoutEffect(() => {
    if (visible && atBottom.current) toBottom();
  }, [visible]);

  useLayoutEffect(() => {
    if (atBottom.current || lastMine) toBottom();
    else setBehind(true);
  }, [total, lastMine]);

  const submit = () => {
    const body = draft.trim();
    if (!body) return;
    chat.send(body);
    setDraft("");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-0 flex-1">
        <div
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
            if (atBottom.current) setBehind(false);
          }}
          className="scrollbar-clean flex h-full flex-col gap-3 overflow-y-auto px-3 py-3"
          role="log"
          aria-live="polite"
          aria-label="Tin nhắn trong phòng"
        >
          {chat.loading && total === 0 ? (
            <div role="status" className="m-auto flex items-center gap-2 text-sm text-rail-foreground/70">
              <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
              Đang tải tin nhắn…
            </div>
          ) : null}
          {chat.loadError ? (
            <div role="alert" className="flex flex-col items-start gap-2 rounded-lg bg-rail-item px-3 py-2 text-sm">
              <span>Không tải được tin nhắn cũ. {chat.loadError}</span>
              <button type="button" onClick={() => chat.reload()} className={cn("inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-rail-item-hover px-2.5 py-1 text-xs font-medium", focusRing)}>
                <RotateCcw className="size-3.5" aria-hidden />
                Thử lại
              </button>
            </div>
          ) : null}
          {!chat.loading && !chat.loadError && total === 0 ? <p className="m-auto max-w-[24ch] text-center text-sm text-rail-foreground/70">Chưa có tin nhắn nào. Tin nhắn chỉ những người trong cuộc họp thấy và được lưu lại.</p> : null}
          {chat.truncated ? <p className="text-center text-xs text-rail-foreground/70">Chỉ hiển thị 2000 tin gần nhất</p> : null}
          {chat.messages.map((m) => {
            const mine = m.author.id === meId;
            return (
              <div key={m.id} className={cn("flex max-w-full gap-2", mine && "flex-row-reverse")}>
                {mine ? null : <Avatar name={m.author.name} src={m.author.avatarUrl} size="size-7" />}
                <div className={cn("flex min-w-0 max-w-[85%] flex-col gap-0.5", mine && "items-end")}>
                  <div className="flex items-baseline gap-2 text-xs text-rail-foreground/70">
                    {mine ? null : <span className="truncate font-medium text-rail-foreground">{m.author.name}</span>}
                    <time dateTime={m.createdAt} className="tabular-nums">
                      {timeOf(m.createdAt)}
                    </time>
                  </div>
                  <div className={cn("rounded-2xl px-3 py-2", mine ? "bg-primary text-primary-foreground" : "bg-rail-item text-rail-foreground")}>
                    <MessageText body={m.body} />
                  </div>
                </div>
              </div>
            );
          })}
          {chat.pending.map((p) => (
            <div key={p.tempId} className="flex flex-row-reverse gap-2">
              <div className="flex min-w-0 max-w-[85%] flex-col items-end gap-1">
                <div className={cn("rounded-2xl bg-primary px-3 py-2 text-primary-foreground", !p.error && "opacity-60")}>
                  <MessageText body={p.body} />
                </div>
                {p.error ? (
                  <div role="alert" className="flex flex-col items-end gap-1 text-xs text-err-line">
                    <span>{p.error}</span>
                    <span className="flex gap-3">
                      <button type="button" onClick={() => chat.retry(p.tempId)} className={cn("cursor-pointer font-medium underline", focusRing)}>
                        Gửi lại
                      </button>
                      <button type="button" onClick={() => chat.dismiss(p.tempId)} className={cn("cursor-pointer underline", focusRing)}>
                        Xóa
                      </button>
                    </span>
                  </div>
                ) : (
                  <span className="text-xs text-rail-foreground/70">Đang gửi…</span>
                )}
              </div>
            </div>
          ))}
        </div>
        {behind ? (
          <button type="button" onClick={toBottom} className={cn("absolute bottom-2 left-1/2 inline-flex -translate-x-1/2 cursor-pointer items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-popover", focusRing)}>
            <ArrowDown className="size-3.5" aria-hidden />
            Tin mới
          </button>
        ) : null}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex shrink-0 items-end gap-2 border-t border-rail-item p-3"
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          maxLength={MAX_LENGTH}
          aria-label="Nhập tin nhắn"
          placeholder="Nhắn cho mọi người…"
          className={cn("max-h-28 min-h-10 min-w-0 flex-1 resize-none rounded-xl bg-rail-item px-3 py-2 text-sm text-rail-foreground placeholder:text-rail-foreground/60", focusRing)}
        />
        <button type="submit" aria-label="Gửi tin nhắn" disabled={!draft.trim()} className={cn("inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-primary text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50", focusRing)}>
          <Send className="size-4" aria-hidden />
        </button>
      </form>
    </div>
  );
}

function PersonRow({ participant, canMute, onMute, busy }: { participant: Participant; canMute: boolean; onMute: (p: Participant) => void; busy: boolean }) {
  const muted = useIsMuted({ participant, source: Track.Source.Microphone });
  const { attributes } = useParticipantAttributes({ participant });
  const raised = attributes?.handRaised === "true";
  const name = participant.name || participant.identity;
  return (
    <li className="flex min-h-12 items-center gap-3 px-3 py-2">
      <Avatar name={name} size="size-8" />
      <span className="min-w-0 flex-1 truncate text-sm">
        {name}
        {participant.isLocal ? <span className="text-rail-foreground/70"> (Bạn)</span> : null}
      </span>
      {raised ? (
        <span role="img" aria-label="Đang giơ tay" title="Đang giơ tay" className="text-base">
          ✋
        </span>
      ) : null}
      {muted ? <MicOff role="img" className="size-4 shrink-0 text-err-line" aria-label="Mic đang tắt" /> : <Mic role="img" className="size-4 shrink-0 text-rail-foreground/70" aria-label="Mic đang bật" />}
      {canMute && !participant.isLocal ? (
        <button
          type="button"
          disabled={busy || muted}
          onClick={() => onMute(participant)}
          aria-label={`Tắt mic của ${name}`}
          className={cn("inline-flex h-8 shrink-0 cursor-pointer items-center rounded-lg bg-rail-item px-2.5 text-xs font-medium text-rail-foreground transition-colors hover:bg-rail-item-hover disabled:cursor-not-allowed disabled:opacity-50", focusRing)}
        >
          Tắt mic
        </button>
      ) : null}
    </li>
  );
}

function PeopleView({ meetingId, isHost }: { meetingId: string; isHost: boolean }) {
  const toast = useToast();
  const participants = useParticipants().filter((p) => !p.permissions?.hidden);
  const [busyId, setBusyId] = useState<string | null>(null);
  const mute = async (p: Participant) => {
    setBusyId(p.identity);
    try {
      const res = await muteParticipant(meetingId, p.identity);
      if (!res.muted) toast("error", `${p.name || p.identity} chưa bật mic nên không có gì để tắt.`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) toast("error", "Chưa tắt được mic. Dịch vụ phòng họp đang bận, thử lại sau ít giây.");
      else toast("error", meetingErrorText(err));
    } finally {
      setBusyId(null);
    }
  };
  return (
    <ul className="scrollbar-clean min-h-0 flex-1 divide-y divide-rail-item overflow-y-auto" aria-label="Người trong phòng">
      {participants.map((p) => (
        <PersonRow key={p.identity} participant={p} canMute={isHost} onMute={(x) => void mute(x)} busy={busyId === p.identity} />
      ))}
    </ul>
  );
}

export function RoomSidePanel({ open, tab, onTab, onClose, chat, meetingId, meId, isHost }: { open: boolean; tab: PanelTab; onTab: (t: PanelTab) => void; onClose: () => void; chat: MeetingChat; meetingId: string; meId: string; isHost: boolean }) {
  const asideRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    if (window.matchMedia("(min-width: 1024px)").matches) return;
    asideRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
  }, [open]);
  const count = useParticipants().filter((p) => !p.permissions?.hidden).length;
  const tabs: Array<{ value: PanelTab; label: string }> = [
    { value: "chat", label: "Chat" },
    { value: "people", label: `Người (${count})` },
  ];
  return (
    <aside
      ref={asideRef}
      aria-label="Chat và người tham gia"
      hidden={!open}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !window.matchMedia("(min-width: 1024px)").matches) {
          e.stopPropagation();
          onClose();
        }
      }} className={cn("z-20 flex-col bg-rail", open ? "absolute inset-x-0 top-0 bottom-0 flex lg:static lg:inset-auto lg:w-80 lg:shrink-0 lg:border-l lg:border-rail-item" : "hidden")}>
      <div className="flex shrink-0 items-center gap-1 border-b border-rail-item px-2 py-2">
        <div role="tablist" aria-label="Bảng bên" className="flex flex-1 gap-1">
          {tabs.map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={tab === t.value}
              onClick={() => onTab(t.value)}
              className={cn("inline-flex h-9 cursor-pointer items-center rounded-lg px-3 text-sm font-medium transition-colors", focusRing, tab === t.value ? "bg-rail-item text-rail-foreground" : "text-rail-foreground/70 hover:bg-rail-item/60 hover:text-rail-foreground")}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button type="button" onClick={onClose} aria-label="Đóng bảng bên" className={cn("inline-flex size-9 cursor-pointer items-center justify-center rounded-lg text-rail-foreground/70 hover:bg-rail-item/60 hover:text-rail-foreground", focusRing)}>
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <div className={cn("min-h-0 flex-1 flex-col", tab === "chat" ? "flex" : "hidden")}>
        <ChatView chat={chat} meId={meId} visible={open && tab === "chat"} />
      </div>
      {tab === "people" ? <PeopleView meetingId={meetingId} isHost={isHost} /> : null}
    </aside>
  );
}
