import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { jsonToMarkdown } from '@luna/editor';
import {
  ClaudeMinutesWriter,
  DeepgramSpeechToText,
  GeminiSpeechToText,
  MINUTES_OUTPUT_RULES,
  MINUTES_SYSTEM_PROMPT,
  OmniRouteMinutesWriter,
  OmniRouteSpeechToText,
  buildMinutesUserMessage,
  buildTimeline,
  foldName,
  formatTimelineForPrompt,
  llmCostMicroUsd,
  minutesAiEnvSchema,
  renderMinutesDoc,
  sttCostMicroUsd,
  type MinutesAiEnv,
  type MinutesWriter,
  type SpeechToText,
  type SttSegment,
} from '@luna/meetings';
import { loadEnv } from '@luna/shared';

const run = promisify(execFile);
const REPO_ROOT = resolve(import.meta.dirname, '../..');

interface SpeakerFile {
  speakerId: string;
  name: string;
  file: string;
  startOffsetMs: number;
}

interface ExpectedAction {
  task: string;
  owner: string;
}

interface CaseData {
  name: string;
  dir: string;
  speakers: SpeakerFile[];
  reference: Map<string, string>;
  keyterms: string[];
  expected: ExpectedAction[];
}

function parseArgs(argv: string[]): { cases: string; stt: string[]; llm: string[] } {
  const out = { cases: '.superpowers/eval/meetings', stt: [] as string[], llm: [] as string[] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = argv[i + 1];
    if (a === '--cases' && v) out.cases = v;
    if (a === '--stt' && v) out.stt = v.split(',').filter(Boolean);
    if (a === '--llm' && v) out.llm = v.split(',').filter(Boolean);
  }
  return out;
}

function normalize(s: string): string {
  return s
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a: string[], b: string[]): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length]!;
}

function cer(reference: string, hypothesis: string): number {
  const ref = [...normalize(reference)];
  if (ref.length === 0) return 0;
  return levenshtein(ref, [...normalize(hypothesis)]) / ref.length;
}

function keytermRecall(
  keyterms: string[],
  reference: string,
  hypothesis: string,
): { hit: number; total: number } {
  const ref = normalize(reference);
  const hyp = normalize(hypothesis);
  const present = keyterms.map(normalize).filter((t) => t.length > 0 && ref.includes(t));
  return { hit: present.filter((t) => hyp.includes(t)).length, total: present.length };
}

async function audioDurationMs(file: string): Promise<number> {
  const { stdout } = await run('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=nw=1:nk=1',
    file,
  ]);
  return Math.round(Number.parseFloat(stdout.trim()) * 1000);
}

async function loadCase(root: string, name: string): Promise<CaseData> {
  const dir = join(root, name);
  const speakers = JSON.parse(await readFile(join(dir, 'speakers.json'), 'utf8')) as SpeakerFile[];
  const reference = new Map<string, string>();
  for (const line of (await readFile(join(dir, 'reference.txt'), 'utf8')).split('\n')) {
    const m = /^(\S+?):\s*(.*)$/.exec(line.trim());
    if (m) reference.set(m[1]!, `${reference.get(m[1]!) ?? ''} ${m[2]!}`.trim());
  }
  const keyterms = (await readFile(join(dir, 'keyterms.txt'), 'utf8'))
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  const expected = JSON.parse(
    await readFile(join(dir, 'expected-actions.json'), 'utf8'),
  ) as ExpectedAction[];
  return { name, dir, speakers, reference, keyterms, expected };
}

function buildStt(spec: string, env: MinutesAiEnv): SpeechToText {
  const [kind, arg] = spec.split(':');
  if (kind === 'deepgram') {
    if (!env.DEEPGRAM_API_KEY) throw new Error('DEEPGRAM_API_KEY chưa đặt');
    return new DeepgramSpeechToText({
      apiKey: env.DEEPGRAM_API_KEY,
      model: 'nova-3',
      language: arg === 'multi' ? 'multi' : 'vi',
    });
  }
  if (kind === 'gemini') {
    if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY chưa đặt');
    return new GeminiSpeechToText({ apiKey: env.GEMINI_API_KEY, model: arg ?? 'gemini-2.5-flash' });
  }
  if (kind === 'omniroute') {
    if (!env.OMNIROUTE_API_KEY || !env.OMNIROUTE_BASE_URL) throw new Error('OMNIROUTE_* chưa đặt');
    return new OmniRouteSpeechToText({
      baseUrl: env.OMNIROUTE_BASE_URL,
      apiKey: env.OMNIROUTE_API_KEY,
      model: arg ?? env.MEETING_OMNIROUTE_STT_MODEL,
    });
  }
  throw new Error(`STT không hỗ trợ: ${spec}`);
}

function buildLlm(spec: string, env: MinutesAiEnv): MinutesWriter {
  if (spec === 'omniroute' || spec.startsWith('omniroute:')) {
    if (!env.OMNIROUTE_API_KEY || !env.OMNIROUTE_BASE_URL) throw new Error('OMNIROUTE_* chưa đặt');
    return new OmniRouteMinutesWriter({
      baseUrl: env.OMNIROUTE_BASE_URL,
      apiKey: env.OMNIROUTE_API_KEY,
      model: spec.split(':')[1] ?? env.MEETING_OMNIROUTE_LLM_MODEL,
    });
  }
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY chưa đặt');
  return new ClaudeMinutesWriter({
    apiKey: env.ANTHROPIC_API_KEY,
    model: spec,
    effort: env.MEETING_LLM_EFFORT,
  });
}

function tokens(s: string): Set<string> {
  return new Set(
    normalize(s)
      .split(' ')
      .filter((t) => t.length > 1),
  );
}

function overlap(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  return common / Math.min(ta.size, tb.size);
}

function compareActions(
  expected: ExpectedAction[],
  actual: Array<{ task: string; owner: string }>,
): { matched: number; missing: ExpectedAction[]; extra: Array<{ task: string; owner: string }> } {
  const used = new Set<number>();
  const missing: ExpectedAction[] = [];
  let matched = 0;
  for (const e of expected) {
    const idx = actual.findIndex(
      (a, i) =>
        !used.has(i) && foldName(a.owner) === foldName(e.owner) && overlap(a.task, e.task) >= 0.5,
    );
    if (idx >= 0) {
      used.add(idx);
      matched++;
    } else {
      missing.push(e);
    }
  }
  return { matched, missing, extra: actual.filter((_, i) => !used.has(i)) };
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const usd = (micro: bigint) => `${(Number(micro) / 1e6).toFixed(4)} USD`;

async function evalStt(
  stt: SpeechToText,
  label: string,
  c: CaseData,
  env: MinutesAiEnv,
): Promise<{ lines: string[]; hypotheses: Map<string, SttSegment[]> }> {
  const hypotheses = new Map<string, SttSegment[]>();
  let totalMs = 0;
  let audioMs = 0;
  let refAll = '';
  let hypAll = '';
  let failed: string | null = null;
  const t0 = Date.now();
  for (const s of c.speakers) {
    const file = join(c.dir, s.file);
    const body = await readFile(file);
    const durationMs = await audioDurationMs(file);
    audioMs += durationMs;
    try {
      const segs = await stt.transcribe(
        { body, mime: 'audio/ogg', durationMs },
        { keyterms: c.keyterms },
      );
      hypotheses.set(
        s.speakerId,
        segs.map((x) => ({
          ...x,
          startMs: x.startMs + s.startOffsetMs,
          endMs: x.endMs + s.startOffsetMs,
        })),
      );
      refAll += ` ${c.reference.get(s.speakerId) ?? ''}`;
      hypAll += ` ${segs.map((x) => x.text).join(' ')}`;
    } catch (err) {
      failed = err instanceof Error ? err.message : String(err);
    }
  }
  totalMs = Date.now() - t0;
  if (failed)
    return { lines: [`| ${label} | lỗi: ${failed.replace(/\|/g, '/')} | | | | |`], hypotheses };
  const recall = keytermRecall(c.keyterms, refAll, hypAll);
  const cost = sttCostMicroUsd(audioMs, env.MEETING_STT_USD_PER_MIN);
  return {
    lines: [
      `| ${label} | ${pct(cer(refAll, hypAll))} | ${recall.total === 0 ? 'n/a' : pct(recall.hit / recall.total)} (${recall.hit}/${recall.total}) | ${(totalMs / 1000).toFixed(1)} s | ${usd(cost)} |`,
    ],
    hypotheses,
  };
}

async function evalLlm(
  writer: MinutesWriter,
  label: string,
  c: CaseData,
  env: MinutesAiEnv,
): Promise<string[]> {
  const meetingStart = new Date('2026-11-03T02:00:00Z');
  const names = new Map(c.speakers.map((s) => [s.speakerId, s.name]));
  const utterances: Array<{ userId: string; startMs: number; endMs: number; text: string }> = [];
  let cursor = 0;
  for (const line of await readFile(join(c.dir, 'reference.txt'), 'utf8').then((t) =>
    t.split('\n'),
  )) {
    const m = /^(\S+?):\s*(.+)$/.exec(line.trim());
    if (!m) continue;
    utterances.push({ userId: m[1]!, startMs: cursor, endMs: cursor + 4000, text: m[2]! });
    cursor += 6000;
  }
  const timeline = buildTimeline({ utterances, chat: [], meetingStartedAt: meetingStart, names });
  const user = buildMinutesUserMessage({
    title: c.name,
    meetingDate: '2026-11-03',
    speakers: timeline.speakers,
    timeline: formatTimelineForPrompt(timeline),
  });
  const t0 = Date.now();
  try {
    const out = await writer.write({
      system: `${MINUTES_SYSTEM_PROMPT}\n${MINUTES_OUTPUT_RULES}`,
      user,
    });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const doc = renderMinutesDoc({
      title: c.name,
      startedAt: meetingStart,
      endedAt: new Date(meetingStart.getTime() + cursor),
      hostName: c.speakers[0]?.name ?? '',
      attendeeCount: c.speakers.length,
      attendeeIds: [],
      absentees: [],
      droppedItemCount: 0,
      draft: out.draft,
      speakers: timeline.speakers,
      entries: timeline.entries,
      suggestions: [],
      timeZone: 'Asia/Ho_Chi_Minh',
    });
    const speakerName = new Map(timeline.speakers.map((s) => [s.speakerId, s.name]));
    const actual = out.draft.actionItems.map((a) => ({
      task: a.task,
      owner: a.ownerSpeakerId
        ? (speakerName.get(a.ownerSpeakerId) ?? a.ownerName ?? '')
        : (a.ownerName ?? ''),
    }));
    const cmp = compareActions(c.expected, actual);
    const cost = llmCostMicroUsd(
      out.inputTokens,
      out.outputTokens,
      env.MEETING_LLM_USD_PER_MTOK_IN,
      env.MEETING_LLM_USD_PER_MTOK_OUT,
    );
    return [
      `#### ${label}`,
      '',
      `Thời gian ${secs} s, token vào ${out.inputTokens}, ra ${out.outputTokens}, chi phí ${usd(cost)}.`,
      `Việc khớp ${cmp.matched}/${c.expected.length}, thiếu ${cmp.missing.length}, thừa hoặc có thể bịa ${cmp.extra.length} (người duyệt xác nhận).`,
      ...cmp.missing.map((m) => `- Thiếu: ${m.task} (${m.owner})`),
      ...cmp.extra.map((m) => `- Thừa: ${m.task} (${m.owner})`),
      '',
      '```markdown',
      jsonToMarkdown(doc),
      '```',
      '',
    ];
  } catch (err) {
    return [`#### ${label}`, '', `Lỗi: ${err instanceof Error ? err.message : String(err)}`, ''];
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const env = loadEnv(minutesAiEnvSchema);
  const root = resolve(REPO_ROOT, args.cases);
  if (!existsSync(root)) throw new Error(`Không thấy thư mục case: ${root}`);
  const names = (await readdir(root, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  if (names.length === 0) throw new Error(`Thư mục case trống: ${root}`);
  const report: string[] = [
    `# Đánh giá chép lời và biên bản`,
    '',
    `Tạo lúc ${new Date().toISOString()}`,
    '',
  ];
  for (const name of names) {
    const c = await loadCase(root, name);
    report.push(`## ${c.name}`, '');
    if (args.stt.length > 0) {
      report.push(
        '### Chép lời',
        '',
        '| Phương án | CER | Nhận đúng thuật ngữ | Thời gian | Chi phí |',
        '|---|---|---|---|---|',
      );
      for (const spec of args.stt) {
        const res = await evalStt(buildStt(spec, env), spec, c, env);
        report.push(...res.lines);
      }
      report.push('');
    }
    if (args.llm.length > 0) {
      report.push('### Biên bản', '');
      for (const spec of args.llm)
        report.push(...(await evalLlm(buildLlm(spec, env), spec, c, env)));
    }
  }
  const outDir = resolve(REPO_ROOT, '.superpowers/eval');
  await mkdir(outDir, { recursive: true });
  const file = join(outDir, `report-${new Date().toISOString().replace(/[:.]/g, '-')}.md`);
  await writeFile(file, `${report.join('\n')}\n`);
  console.log(`Đã ghi ${file}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
