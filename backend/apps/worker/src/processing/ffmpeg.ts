import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface ProbeResult {
  durationSec: number;
  width: number;
  height: number;
  hasAudio: boolean;
}

export interface Rendition {
  name: string;
  width: number;
  height: number;
  videoKbps: number;
  audioKbps: number;
}

export interface FfmpegTools {
  ffmpeg: string;
  ffprobe: string;
  encoder: 'libx264' | 'h264_nvenc';
  threads: number;
  nice: number;
}

export function ffmpegCommand(tools: FfmpegTools, args: string[]): { cmd: string; args: string[] } {
  return tools.nice > 0
    ? { cmd: 'nice', args: ['-n', String(tools.nice), tools.ffmpeg, ...args] }
    : { cmd: tools.ffmpeg, args };
}

export function threadArgs(threads: number): { global: string[]; output: string[] } {
  return threads > 0
    ? {
        global: ['-filter_complex_threads', String(threads)],
        output: ['-threads', String(threads)],
      }
    : { global: [], output: [] };
}

export class InvalidVideoError extends Error {
  override readonly name = 'InvalidVideoError';
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
  }
}

function run(
  cmd: string,
  args: string[],
  onStdout?: (chunk: string) => void,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (c: string) => {
      if (onStdout) onStdout(c);
      else stdout += c;
    });
    child.stderr.setEncoding('utf8').on('data', (c: string) => {
      stderr = (stderr + c).slice(-8000);
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve({ stdout, stderr })
        : reject(
            new Error(
              `${cmd} exited with ${code}: ${stderr.trim().split('\n').slice(-3).join(' | ')}`,
            ),
          ),
    );
  });
}

const VIDEO_CONTAINERS = new Set(['mov,mp4,m4a,3gp,3g2,mj2', 'matroska,webm']);

export async function probe(tools: FfmpegTools, path: string): Promise<ProbeResult> {
  let json: {
    format?: { duration?: string; format_name?: string };
    streams?: Array<{
      codec_type: string;
      width?: number;
      height?: number;
      duration?: string;
      side_data_list?: Array<{ rotation?: number }>;
      tags?: { rotate?: string };
    }>;
  };
  try {
    const { stdout } = await run(tools.ffprobe, [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      '-protocol_whitelist',
      'file',
      path,
    ]);
    json = JSON.parse(stdout);
  } catch (err) {
    throw new InvalidVideoError(
      'This file cannot be read as a video. It may be damaged or in an unsupported format.',
      (err as Error).message,
    );
  }
  if (!VIDEO_CONTAINERS.has(json.format?.format_name ?? '')) {
    throw new InvalidVideoError(
      'This file is not in a supported video format (MP4, MOV, M4V, WebM or MKV).',
      `ffprobe format: ${json.format?.format_name ?? 'unknown'}`,
    );
  }
  const video = json.streams?.find((s) => s.codec_type === 'video' && s.width && s.height);
  if (!video) throw new InvalidVideoError('This file has no video track.');
  const durationSec = Number(json.format?.duration ?? video.duration ?? 0);
  if (!(durationSec > 0)) throw new InvalidVideoError('This video has no playable length.');
  const rotation =
    Math.abs(
      Number(
        video.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ??
          video.tags?.rotate ??
          0,
      ),
    ) % 180;
  const [width, height] =
    rotation === 90 ? [video.height!, video.width!] : [video.width!, video.height!];
  return {
    durationSec,
    width,
    height,
    hasAudio: !!json.streams?.some((s) => s.codec_type === 'audio'),
  };
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export function buildLadder(width: number, height: number): Rendition[] {
  const short = Math.min(width, height);
  const steps = [
    { short: 360, videoKbps: 800, audioKbps: 96 },
    { short: 720, videoKbps: 2800, audioKbps: 128 },
    { short: 1080, videoKbps: 5000, audioKbps: 128 },
  ].filter((s) => s.short <= short);
  if (!steps.length) steps.push({ short, videoKbps: 600, audioKbps: 96 });
  return steps.map((s) => {
    const scale = s.short / short;
    return {
      name: `${s.short}p`,
      width: even(width * scale),
      height: even(height * scale),
      videoKbps: s.videoKbps,
      audioKbps: s.audioKbps,
    };
  });
}

export async function transcodeHls(
  tools: FfmpegTools,
  opts: {
    src: string;
    outDir: string;
    workDir: string;
    ladder: Rendition[];
    hasAudio: boolean;
    key: Buffer;
    iv: Buffer;
    durationSec: number;
    onProgress: (percent: number) => void;
  },
) {
  const keyPath = join(opts.workDir, 'video.key');
  const keyInfo = join(opts.workDir, 'video.keyinfo');
  await writeFile(keyPath, opts.key);
  await writeFile(keyInfo, `luna-key\n${keyPath}\n${opts.iv.toString('hex')}\n`);

  const n = opts.ladder.length;
  const split = n > 1 ? `[0:v]split=${n}${opts.ladder.map((_, i) => `[s${i}]`).join('')};` : '';
  const scales = opts.ladder
    .map(
      (r, i) =>
        `[${n > 1 ? `s${i}` : '0:v'}]scale=${r.width}:${r.height}:flags=bicubic,setsar=1[v${i}]`,
    )
    .join(';');
  const threads = threadArgs(tools.threads);
  const args = [
    ...threads.global,
    '-hide_banner',
    '-nostats',
    '-y',
    '-protocol_whitelist',
    'file',
    '-i',
    opts.src,
    '-filter_complex',
    split + scales,
  ];
  opts.ladder.forEach((r, i) => {
    args.push('-map', `[v${i}]`);
    args.push(`-c:v:${i}`, tools.encoder, `-b:v:${i}`, `${r.videoKbps}k`);
    args.push(
      `-maxrate:v:${i}`,
      `${Math.round(r.videoKbps * 1.07)}k`,
      `-bufsize:v:${i}`,
      `${r.videoKbps * 2}k`,
    );
  });
  if (opts.hasAudio) {
    opts.ladder.forEach((r, i) =>
      args.push(
        '-map',
        'a:0',
        `-c:a:${i}`,
        'aac',
        `-b:a:${i}`,
        `${r.audioKbps}k`,
        `-ac:a:${i}`,
        '2',
      ),
    );
  }
  args.push(
    ...(tools.encoder === 'libx264' ? ['-preset', 'veryfast'] : ['-preset', 'p4', '-rc', 'vbr']),
    '-profile:v',
    'main',
    '-pix_fmt',
    'yuv420p',
    '-force_key_frames',
    'expr:gte(t,n_forced*6)',
    '-sc_threshold',
    '0',
    ...threads.output,
    '-f',
    'hls',
    '-hls_time',
    '6',
    '-hls_playlist_type',
    'vod',
    '-hls_flags',
    'independent_segments',
    '-hls_key_info_file',
    keyInfo,
    '-hls_segment_filename',
    join(opts.outDir, '%v', 'seg_%04d.ts'),
    '-master_pl_name',
    'master.m3u8',
    '-var_stream_map',
    opts.ladder.map((r, i) => `v:${i}${opts.hasAudio ? `,a:${i}` : ''},name:${r.name}`).join(' '),
    '-progress',
    'pipe:1',
    join(opts.outDir, '%v', 'index.m3u8'),
  );

  let buffer = '';
  const command = ffmpegCommand(tools, args);
  await run(command.cmd, command.args, (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const m = /^out_time_us=(\d+)/.exec(line);
      if (m) opts.onProgress(Math.min(99, (Number(m[1]) / 1e6 / opts.durationSec) * 100));
    }
  });
}

export async function extractPoster(
  tools: FfmpegTools,
  src: string,
  out: string,
  durationSec: number,
) {
  const at = Math.min(5, durationSec * 0.1);
  const command = ffmpegCommand(tools, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-ss',
    at.toFixed(2),
    '-protocol_whitelist',
    'file',
    '-i',
    src,
    '-frames:v',
    '1',
    '-vf',
    "scale='min(1280,iw)':-2",
    '-q:v',
    '3',
    out,
  ]);
  await run(command.cmd, command.args);
}

export async function buildSprite(
  tools: FfmpegTools,
  src: string,
  out: string,
  probeResult: ProbeResult,
): Promise<string> {
  const { durationSec, width, height } = probeResult;
  const interval = Math.max(2, Math.ceil(durationSec / 100));
  const count = Math.max(1, Math.ceil(durationSec / interval));
  const cols = Math.min(10, count);
  const rows = Math.ceil(count / cols);
  const tw = 160;
  const th = even((tw * height) / width);
  const command = ffmpegCommand(tools, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-protocol_whitelist',
    'file',
    '-i',
    src,
    '-vf',
    `fps=1/${interval},scale=${tw}:${th},tile=${cols}x${rows}`,
    '-frames:v',
    '1',
    '-q:v',
    '4',
    out,
  ]);
  await run(command.cmd, command.args);
  const ts = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${sec.toFixed(3).padStart(6, '0')}`;
  };
  const cues = Array.from({ length: count }, (_, i) => {
    const start = i * interval;
    const end = Math.min((i + 1) * interval, durationSec);
    const x = (i % cols) * tw;
    const y = Math.floor(i / cols) * th;
    return `${ts(start)} --> ${ts(end)}\nsprite.jpg#xywh=${x},${y},${tw},${th}`;
  });
  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}
