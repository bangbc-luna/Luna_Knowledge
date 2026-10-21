"use client";

import { useRef, useState } from "react";
import { formatDuration } from "@/lib/format";

export interface SpriteCue {
  start: number;
  end: number;
  url: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const toSec = (t: string) => t.split(":").reduce((acc, part) => acc * 60 + Number(part), 0);

export function parseSpriteVtt(text: string): SpriteCue[] {
  const cues: SpriteCue[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const lines = block.trim().split(/\r?\n/);
    const timing = lines.find((l) => l.includes("-->"));
    const target = lines[lines.indexOf(timing ?? "") + 1];
    if (!timing || !target) continue;
    const [from, to] = timing.split("-->").map((s) => s.trim());
    const hash = target.lastIndexOf("#xywh=");
    if (hash < 0) continue;
    const [x, y, w, h] = target.slice(hash + 6).split(",").map(Number);
    cues.push({ start: toSec(from!), end: toSec(to!), url: target.slice(0, hash), x: x!, y: y!, w: w!, h: h! });
  }
  return cues;
}

const KEY_STEP_SEC = 5;

export function PreviewStrip({
  cues,
  current,
  duration,
  onSeek,
}: {
  cues: SpriteCue[];
  current: number;
  duration: number;
  onSeek: (sec: number) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ ratio: number; dragging: boolean } | null>(null);

  const ratioAt = (clientX: number) => {
    const r = track.current?.getBoundingClientRect();
    if (!r || !r.width) return 0;
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  };

  const hoverSec = hover ? hover.ratio * duration : 0;
  const cue = hover ? (cues.find((c) => hoverSec >= c.start && hoverSec < c.end) ?? cues.at(-1)) : null;
  const played = duration ? Math.min(100, (current / duration) * 100) : 0;

  return (
    <div className="px-3 pt-3 pb-1 sm:px-4">
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label="Tua video, rê để xem trước"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(current)}
        aria-valuetext={`${formatDuration(current)} / ${formatDuration(duration)}`}
        className="relative flex h-8 cursor-pointer touch-none items-center outline-hidden"
        onPointerMove={(e) => setHover({ ratio: ratioAt(e.clientX), dragging: hover?.dragging ?? false })}
        onPointerLeave={() => !hover?.dragging && setHover(null)}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setHover({ ratio: ratioAt(e.clientX), dragging: true });
        }}
        onPointerUp={(e) => {
          onSeek(ratioAt(e.clientX) * duration);
          setHover(e.pointerType === "mouse" ? { ratio: ratioAt(e.clientX), dragging: false } : null);
        }}
        onPointerCancel={() => setHover(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") onSeek(Math.min(duration, current + KEY_STEP_SEC));
          else if (e.key === "ArrowLeft") onSeek(Math.max(0, current - KEY_STEP_SEC));
          else return;
          e.preventDefault();
        }}
      >
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
          <div className="h-full rounded-full bg-primary" style={{ width: `${played}%` }} />
        </div>
        {hover && cue ? (
          <div
            className="pointer-events-none absolute bottom-full z-10 mb-2 -translate-x-1/2 overflow-hidden rounded-lg border border-border bg-surface-overlay shadow-popover"
            style={{ left: `clamp(${cue.w / 2 + 4}px, ${hover.ratio * 100}%, calc(100% - ${cue.w / 2 + 4}px))` }}
          >
            <div
              style={{
                width: cue.w,
                height: cue.h,
                backgroundImage: `url("${cue.url}")`,
                backgroundPosition: `-${cue.x}px -${cue.y}px`,
              }}
            />
            <p className="py-1 text-center text-xs font-medium text-foreground tabular-nums">{formatDuration(hoverSec)}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
