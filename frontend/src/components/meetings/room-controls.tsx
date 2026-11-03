"use client";

import { useLocalParticipant, useRoomContext } from "@livekit/components-react";
import { Hand, MessageSquare, Mic, MicOff, MonitorUp, PhoneOff, ScreenShareOff, Settings2, SmilePlus, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { meetingErrorText } from "./meeting-errors";
import { cn } from "@/lib/cn";
import { ConfirmDialog } from "../ui/dialog";
import { focusRing } from "../ui/focus";
import { MenuItem, PopoverPanel, usePopover } from "../ui/popover";
import { useToast } from "../ui/toast";
import { REACTIONS } from "./reactions";
import type { Reaction } from "./reactions";

export function ControlButton({ icon: Icon, label, active = true, danger, pressed, onClick, className }: { icon: LucideIcon; label: string; active?: boolean; danger?: boolean; pressed?: boolean; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "inline-flex size-11 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full text-sm font-medium transition-colors",
        focusRing,
        danger ? "bg-err text-rail-foreground hover:bg-err/85" : active ? "bg-rail-item text-rail-foreground hover:bg-rail-item-hover" : "bg-err-bg text-err hover:bg-err-bg/85",
        className,
      )}
    >
      <Icon className="size-5" aria-hidden />
    </button>
  );
}

function HostMenu({ aiOn, onToggleAi }: { aiOn: boolean; onToggleAi: () => Promise<void> }) {
  const { open, toggle, rootRef } = usePopover();
  const [busy, setBusy] = useState(false);
  return (
    <>
      <div ref={rootRef} className="relative">
        <ControlButton icon={Settings2} label="Quản lý buổi họp" pressed={open} onClick={toggle} />
        <PopoverPanel open={open} offset="lg" className="w-72 max-w-[calc(100vw-2rem)] text-foreground">
          <div className="px-1">
            <div className="flex min-h-10 items-center gap-3 px-3 py-2">
              <span id="room-ai-label" className="min-w-0 flex-1 text-sm">
                Ghi biên bản AI
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={aiOn}
                aria-labelledby="room-ai-label"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await onToggleAi();
                  } finally {
                    setBusy(false);
                  }
                }}
                className={cn("relative h-6 w-10 shrink-0 cursor-pointer rounded-full transition-colors disabled:cursor-progress disabled:opacity-60", focusRing, aiOn ? "bg-primary" : "bg-border-strong")}
              >
                <span className={cn("absolute top-0.5 left-0.5 size-5 rounded-full bg-surface transition-transform motion-reduce:transition-none", aiOn && "translate-x-4")} />
              </button>
            </div>
          </div>
        </PopoverPanel>
      </div>
    </>
  );
}

const LEAVE_CLASS = "inline-flex h-11 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full bg-err px-4 text-sm font-medium text-rail-foreground hover:bg-err/85";

function LeaveControl({ isHost, onLeave, onEnd }: { isHost: boolean; onLeave: () => void; onEnd: () => Promise<void> }) {
  const { open, setOpen, toggle, rootRef } = usePopover();
  const [confirm, setConfirm] = useState(false);
  if (!isHost) {
    return (
      <button type="button" aria-label="Rời phòng" onClick={onLeave} className={cn(LEAVE_CLASS, focusRing)}>
        <PhoneOff className="size-5" aria-hidden />
        <span className="hidden sm:inline">Rời phòng</span>
      </button>
    );
  }
  return (
    <>
      <div ref={rootRef} className="relative">
        <button type="button" aria-label="Rời hoặc kết thúc buổi họp" aria-haspopup="menu" aria-expanded={open} onClick={toggle} className={cn(LEAVE_CLASS, focusRing)}>
          <PhoneOff className="size-5" aria-hidden />
          <span className="hidden sm:inline">Rời phòng</span>
        </button>
        <PopoverPanel open={open} align="right" offset="lg" className="w-72 max-w-[calc(100vw-2rem)] text-foreground">
          <div className="px-1">
            <MenuItem
              onClick={() => {
                setOpen(false);
                onLeave();
              }}
            >
              <PhoneOff className="size-4 shrink-0" aria-hidden />
              Chỉ mình tôi rời phòng
            </MenuItem>
            <MenuItem
              danger
              onClick={() => {
                setOpen(false);
                setConfirm(true);
              }}
            >
              <PhoneOff className="size-4 shrink-0" aria-hidden />
              Kết thúc cho mọi người
            </MenuItem>
          </div>
        </PopoverPanel>
      </div>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} title="Kết thúc cho mọi người?" danger confirmLabel="Kết thúc cuộc họp" icon={PhoneOff} onConfirm={async () => {
          setConfirm(false);
          await onEnd();
        }}>
        Mọi người sẽ bị đưa ra khỏi phòng và không vào lại được. Hành động này không hoàn tác.
      </ConfirmDialog>
    </>
  );
}

function ReactionMenu({ onReact }: { onReact: (emoji: Reaction) => void }) {
  const { open, setOpen, toggle, rootRef } = usePopover();
  return (
    <div ref={rootRef} className="relative">
      <ControlButton icon={SmilePlus} label="Thả biểu tượng cảm xúc" pressed={open} onClick={toggle} />
      <PopoverPanel open={open} offset="lg" className="left-1/2 -translate-x-1/2 text-foreground">
        <div role="group" aria-label="Biểu tượng cảm xúc" className="flex gap-1 px-2 py-1">
          {REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              aria-label={`Thả ${emoji}`}
              onClick={() => {
                onReact(emoji);
                setOpen(false);
              }}
              className={cn("inline-flex size-10 cursor-pointer items-center justify-center rounded-lg text-2xl transition-colors hover:bg-foreground/5", focusRing)}
            >
              {emoji}
            </button>
          ))}
        </div>
      </PopoverPanel>
    </div>
  );
}

export interface RoomPanelControls {
  open: boolean;
  unread: number;
  onToggle: () => void;
}

export function RoomControls({ isHost, aiOn, onToggleAi, onEnd, onReact, handRaised, onToggleHand, panel, panelWrapRef }: { isHost: boolean; aiOn: boolean; onToggleAi: () => Promise<void>; onEnd: () => Promise<void>; onReact: (emoji: Reaction) => void; handRaised: boolean; onToggleHand: () => void; panel: RoomPanelControls; panelWrapRef: React.RefObject<HTMLDivElement | null> }) {
  const room = useRoomContext();
  const toast = useToast();
  const { localParticipant, isMicrophoneEnabled, isScreenShareEnabled } = useLocalParticipant();
  const canShare = typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getDisplayMedia === "function";
  const run = (fn: () => Promise<unknown>, what: string) => () => {
    fn().catch((err: unknown) => {
      console.error(what, err);
      toast("error", `${what}: ${meetingErrorText(err)}`);
    });
  };
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-center gap-2 border-t border-rail-item px-3 py-3">
      <ControlButton
        icon={isMicrophoneEnabled ? Mic : MicOff}
        label={isMicrophoneEnabled ? "Tắt mic" : "Bật mic"}
        active={isMicrophoneEnabled}
        onClick={run(() => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled), "Không đổi được mic")}
      />
      {canShare ? (
        <ControlButton
          icon={isScreenShareEnabled ? ScreenShareOff : MonitorUp}
          label={isScreenShareEnabled ? "Dừng chia sẻ màn hình" : "Chia sẻ màn hình"}
          pressed={isScreenShareEnabled}
          onClick={run(() => localParticipant.setScreenShareEnabled(!isScreenShareEnabled, isScreenShareEnabled ? undefined : { contentHint: "text", audio: false }), "Không chia sẻ được màn hình")}
        />
      ) : null}
      <ReactionMenu onReact={onReact} />
      <ControlButton icon={Hand} label={handRaised ? "Hạ tay" : "Giơ tay"} pressed={handRaised} active={!handRaised} onClick={onToggleHand} className={handRaised ? "bg-primary text-primary-foreground hover:bg-primary-hover" : undefined} />
      <div ref={panelWrapRef} className="relative">
        <ControlButton icon={MessageSquare} label={panel.open ? "Ẩn chat và danh sách người" : "Mở chat và danh sách người"} pressed={panel.open} onClick={panel.onToggle} />
        {panel.unread > 0 ? (
          <span aria-label={`${panel.unread} tin nhắn mới`} className="pointer-events-none absolute -top-1 -right-1 inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1 text-xs font-semibold text-primary-foreground tabular-nums">
            {panel.unread > 9 ? "9+" : panel.unread}
          </span>
        ) : null}
      </div>
      {isHost ? <HostMenu aiOn={aiOn} onToggleAi={onToggleAi} /> : null}
      <LeaveControl isHost={isHost} onLeave={() => void room.disconnect()} onEnd={onEnd} />
    </div>
  );
}
