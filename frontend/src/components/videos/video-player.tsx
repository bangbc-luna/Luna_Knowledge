"use client";

import { CircleAlert, Maximize } from "lucide-react";
import type HlsType from "hls.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, authHeaders } from "@/lib/api";
import { formatDuration } from "@/lib/format";
import type { Playback } from "@/lib/types";
import { Button, IconButton } from "../ui/button";
import { Select } from "../ui/select";
import { PreviewStrip, type SpriteCue, parseSpriteVtt } from "./preview-strip";

const SAVE_EVERY_MS = 10_000;
const WATERMARK_EVERY_MS = 30_000;
const SPRITE_REFRESH_MS = 8 * 60_000;

type Quality = "auto" | `${number}`;

function saveProgress(nodeId: string, positionSec: number, keepalive = false) {
  if (!(positionSec > 0)) return;
  void fetch(`/api/v1/videos/${nodeId}/progress`, {
    method: "PUT",
    keepalive,
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ positionSec: Math.round(positionSec * 10) / 10 }),
  }).catch(() => undefined);
}

function Watermark({ text }: { text: string }) {
  const [pos, setPos] = useState({ left: 8, top: 12 });
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => {
      setPos({ left: 4 + Math.random() * 52, top: 6 + Math.random() * 76 });
      setNow(new Date());
    }, WATERMARK_EVERY_MS);
    return () => clearInterval(t);
  }, []);
  const time = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }).format(now);
  return (
    <p
      aria-hidden
      className="pointer-events-none absolute z-10 text-xs font-semibold whitespace-nowrap text-white opacity-20 transition-[left,top] duration-700 select-none [text-shadow:0_0_2px_rgb(0_0_0/0.8)] sm:text-sm"
      style={{ left: `${pos.left}%`, top: `${pos.top}%` }}
    >
      {text} · {time}
    </p>
  );
}

const H264_AAC = 'video/mp4; codecs="avc1.42E01E,mp4a.40.2"';
const CODEC_ERRORS = new Set<string>(["manifestIncompatibleCodecsError", "bufferIncompatibleCodecsError", "bufferAddCodecError"]);

function canDecodeH264(el: HTMLVideoElement) {
  const mse = typeof MediaSource !== "undefined" && MediaSource.isTypeSupported(H264_AAC);
  return mse || el.canPlayType(H264_AAC) !== "";
}

export function VideoPlayer({ nodeId, title }: { nodeId: string; title: string }) {
  const stage = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const hls = useRef<HlsType | null>(null);
  const [playback, setPlayback] = useState<Playback | null>(null);
  const [failed, setFailed] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [levels, setLevels] = useState<Array<{ index: number; height: number }>>([]);
  const [quality, setQuality] = useState<Quality>("auto");
  const [autoHeight, setAutoHeight] = useState<number | null>(null);
  const [cues, setCues] = useState<SpriteCue[]>([]);
  const [time, setTime] = useState({ current: 0, duration: 0 });
  const restartAt = useRef<number | null>(null);
  const restarted = useRef(false);

  useEffect(() => {
    let alive = true;
    let instance: HlsType | null = null;
    const el = video.current;
    if (!el) return;
    (async () => {
      try {
        if (!canDecodeH264(el)) {
          setUnsupported(true);
          return;
        }
        const pb = await api<Playback>(`/videos/${nodeId}/playback`, { method: "POST" });
        if (!alive) return;
        setPlayback(pb);
        const resumeFrom = restartAt.current ?? (pb.resumeAt && pb.resumeAt > 5 && pb.resumeAt < pb.durationSec - 10 ? pb.resumeAt : null);
        const { default: Hls } = await import("hls.js");
        if (!alive) return;
        if (Hls.isSupported()) {
          const ceiling = pb.maxHeight;
          const Base = Hls.DefaultConfig.capLevelController!;
          class CeilingCapController extends Base {
            private readonly owner: InstanceType<typeof Hls>;
            constructor(owner: InstanceType<typeof Hls>) {
              super(owner);
              this.owner = owner;
            }
            getMaxLevel(capLevelIndex: number): number {
              const sized = super.getMaxLevel(capLevelIndex);
              if (ceiling === null || sized < 0) return sized;
              const levels = this.owner.levels;
              let best = -1;
              let lowest = 0;
              levels.forEach((l, i) => {
                if (l.height < levels[lowest].height) lowest = i;
                if (l.height <= ceiling && (best < 0 || l.height > levels[best].height)) best = i;
              });
              return Math.min(sized, best < 0 ? lowest : best);
            }
          }
          instance = new Hls({ startPosition: resumeFrom ?? -1, capLevelToPlayerSize: true, capLevelController: CeilingCapController });
          hls.current = instance;
          instance.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
            setLevels(data.levels.map((l, index) => ({ index, height: l.height })).sort((a, b) => b.height - a.height));
          });
          instance.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => setAutoHeight(instance?.levels[data.level]?.height ?? null));
          instance.on(Hls.Events.ERROR, (_e, data) => {
            if (!data.fatal) return;
            if (CODEC_ERRORS.has(data.details)) {
              setUnsupported(true);
              return;
            }
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR && !restarted.current) {
              restarted.current = true;
              restartAt.current = el.currentTime;
              setAttempt((a) => a + 1);
              return;
            }
            setFailed(true);
          });
          instance.loadSource(pb.masterUrl);
          instance.attachMedia(el);
        } else if (el.canPlayType("application/vnd.apple.mpegurl")) {
          el.src = pb.masterUrl;
          if (resumeFrom) el.addEventListener("loadedmetadata", () => (el.currentTime = resumeFrom), { once: true });
        } else {
          setFailed(true);
        }
        restartAt.current = null;
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
      instance?.destroy();
      hls.current = null;
      el.removeAttribute("src");
      el.load();
    };
  }, [nodeId, attempt]);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api<Response>(`/videos/${nodeId}/sprite.vtt`, { raw: true })
        .then((r) => r.text())
        .then((text) => alive && setCues(parseSpriteVtt(text)))
        .catch(() => undefined);
    void load();
    const t = setInterval(load, SPRITE_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [nodeId]);

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    const onTime = () => setTime({ current: el.currentTime, duration: Number.isFinite(el.duration) ? el.duration : 0 });
    const onPause = () => saveProgress(nodeId, el.currentTime);
    const timer = setInterval(() => !el.paused && saveProgress(nodeId, el.currentTime), SAVE_EVERY_MS);
    const onLeave = () => saveProgress(nodeId, el.currentTime, true);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onTime);
    el.addEventListener("pause", onPause);
    window.addEventListener("pagehide", onLeave);
    return () => {
      onLeave();
      clearInterval(timer);
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onTime);
      el.removeEventListener("pause", onPause);
      window.removeEventListener("pagehide", onLeave);
    };
  }, [nodeId]);

  const enterFullscreen = useCallback(() => {
    const box = stage.current as (HTMLDivElement & { webkitRequestFullscreen?: () => void }) | null;
    if (!box) return;
    if (box.requestFullscreen) void box.requestFullscreen().catch(() => undefined);
    else box.webkitRequestFullscreen?.();
  }, []);

  useEffect(() => {
    const el = video.current as (HTMLVideoElement & { webkitExitFullscreen?: () => void }) | null;
    if (!el) return;
    const onChange = () => {
      if (document.fullscreenElement === el) void document.exitFullscreen().then(enterFullscreen).catch(() => undefined);
    };
    const onWebkitBegin = () => {
      el.webkitExitFullscreen?.();
      enterFullscreen();
    };
    document.addEventListener("fullscreenchange", onChange);
    el.addEventListener("webkitbeginfullscreen", onWebkitBegin);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      el.removeEventListener("webkitbeginfullscreen", onWebkitBegin);
    };
  }, [enterFullscreen]);

  const changeQuality = (q: Quality) => {
    setQuality(q);
    if (hls.current) hls.current.currentLevel = q === "auto" ? -1 : Number(q);
  };

  const qualityOptions = [
    { value: "auto" as Quality, label: autoHeight && quality === "auto" ? `Tự động (${autoHeight}p)` : "Tự động" },
    ...levels.map((l) => ({ value: String(l.index) as Quality, label: `${l.height}p` })),
  ];

  return (
    <div className="flex flex-col">
      <div ref={stage} className="relative aspect-video w-full overflow-hidden bg-black [&:fullscreen]:aspect-auto" onContextMenu={(e) => e.preventDefault()}>
        <video
          ref={video}
          className="size-full object-contain outline-hidden"
          controls
          playsInline
          preload="metadata"
          poster={playback?.posterUrl ?? undefined}
          controlsList="nodownload nofullscreen noremoteplayback"
          disablePictureInPicture
          aria-label={title}
        />
        {playback ? <Watermark text={`${playback.watermark.name} · ${playback.watermark.email}`} /> : null}
        {unsupported ? (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-black/80 px-6 text-center">
            <CircleAlert className="size-5 text-white/80" aria-hidden />
            <p className="text-sm font-medium text-white">Trình duyệt này không phát được video</p>
            <p className="max-w-[44ch] text-sm text-pretty text-white/70">
              Video dùng định dạng H.264 mà trình duyệt này không hỗ trợ, ví dụ trình duyệt dựng sẵn trong VS Code. Mở trang bằng Chrome, Edge, Firefox hoặc Safari.
            </p>
          </div>
        ) : failed ? (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-black/80 px-6 text-center">
            <CircleAlert className="size-5 text-white/80" aria-hidden />
            <p className="text-sm font-medium text-white">Không phát được video</p>
            <p className="max-w-[44ch] text-sm text-pretty text-white/70">Mạng chập chờn hoặc phiên xem đã hết hạn.</p>
            <Button
              className="mt-2"
              onClick={() => {
                restartAt.current = video.current?.currentTime ?? null;
                restarted.current = false;
                setFailed(false);
                setAttempt((a) => a + 1);
              }}
            >
              Thử lại
            </Button>
          </div>
        ) : null}
      </div>
      {cues.length && time.duration ? (
        <PreviewStrip
          cues={cues}
          current={time.current}
          duration={time.duration}
          onSeek={(sec) => {
            if (video.current) video.current.currentTime = sec;
          }}
        />
      ) : null}
      <div className="flex items-center gap-2 border-t border-border px-3 py-2 sm:px-4">
        <p className="min-w-0 flex-1 text-sm whitespace-nowrap text-muted tabular-nums">
          {time.duration ? `${formatDuration(time.current)} / ${formatDuration(time.duration)}` : " "}
        </p>
        {levels.length > 1 ? (
          <Select size="inline" align="right" ariaLabel="Chất lượng video" value={quality} options={qualityOptions} onChange={changeQuality} />
        ) : null}
        <IconButton icon={Maximize} label="Toàn màn hình" onClick={enterFullscreen} />
      </div>
    </div>
  );
}
