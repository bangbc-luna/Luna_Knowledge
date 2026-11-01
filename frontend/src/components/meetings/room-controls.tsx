"use client";

import { useLocalParticipant, useRoomContext } from "@livekit/components-react";
import { Mic, MicOff, MonitorUp, PhoneOff, ScreenShareOff, Settings2, Video, VideoOff, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { describeError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { ConfirmDialog } from "../ui/dialog";
import { focusRing } from "../ui/focus";
import { MenuItem, PopoverPanel, usePopover } from "../ui/popover";
import { useToast } from "../ui/toast";

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

function HostMenu({ aiOn, onToggleAi, onEnd }: { aiOn: boolean; onToggleAi: () => Promise<void>; onEnd: () => Promise<void> }) {
  const { open, setOpen, toggle, rootRef } = usePopover();
  const [confirm, setConfirm] = useState(false);
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

export function RoomControls({ isHost, aiOn, onToggleAi, onEnd, extra }: { isHost: boolean; aiOn: boolean; onToggleAi: () => Promise<void>; onEnd: () => Promise<void>; extra?: React.ReactNode }) {
  const room = useRoomContext();
  const toast = useToast();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } = useLocalParticipant();
  const canShare = typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getDisplayMedia === "function";
  const run = (fn: () => Promise<unknown>, what: string) => () => {
    fn().catch((err: unknown) => toast("error", `${what}: ${describeError(err)}`));
  };
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-center gap-2 border-t border-rail-item px-3 py-3">
      <ControlButton
        icon={isMicrophoneEnabled ? Mic : MicOff}
        label={isMicrophoneEnabled ? "Tắt mic" : "Bật mic"}
        active={isMicrophoneEnabled}
        onClick={run(() => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled), "Không đổi được mic")}
      />
      <ControlButton
        icon={isCameraEnabled ? Video : VideoOff}
        label={isCameraEnabled ? "Tắt camera" : "Bật camera"}
        active={isCameraEnabled}
        onClick={run(() => localParticipant.setCameraEnabled(!isCameraEnabled), "Không đổi được camera")}
      />
      {canShare ? (
        <ControlButton
          icon={isScreenShareEnabled ? ScreenShareOff : MonitorUp}
          label={isScreenShareEnabled ? "Dừng chia sẻ màn hình" : "Chia sẻ màn hình"}
          pressed={isScreenShareEnabled}
          onClick={run(() => localParticipant.setScreenShareEnabled(!isScreenShareEnabled, isScreenShareEnabled ? undefined : { contentHint: "text", audio: false }), "Không chia sẻ được màn hình")}
        />
      ) : null}
      {extra}
      {isHost ? <HostMenu aiOn={aiOn} onToggleAi={onToggleAi} onEnd={onEnd} /> : null}
      <button
        type="button"
        aria-label="Rời phòng"
        onClick={() => void room.disconnect()}
        className={cn("inline-flex h-11 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full bg-err px-4 text-sm font-medium text-rail-foreground hover:bg-err/85", focusRing)}
      >
        <PhoneOff className="size-5" aria-hidden />
        <span className="hidden sm:inline">Rời phòng</span>
      </button>
    </div>
  );
}
