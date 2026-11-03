export interface Speaker {
  speakerId: string;
  userId: string;
  name: string;
}

export interface TimelineEntry {
  refId: string;
  kind: 'speech' | 'chat';
  speakerId: string;
  userId: string;
  startMs: number;
  endMs: number;
  text: string;
}

export interface TimelineInput {
  utterances: Array<{ userId: string; startMs: number; endMs: number; text: string }>;
  chat: Array<{ userId: string; body: string; createdAt: Date }>;
  meetingStartedAt: Date;
  names: Map<string, string>;
}

const MERGE_GAP_MS = 2000;

type Raw = Omit<TimelineEntry, 'refId' | 'speakerId'>;

function mergeSpeech(utterances: TimelineInput['utterances']): Raw[] {
  const sorted = [...utterances].sort((a, b) => a.startMs - b.startMs);
  const merged: Raw[] = [];
  for (const u of sorted) {
    const last = merged.at(-1);
    if (last && last.userId === u.userId && u.startMs - last.endMs < MERGE_GAP_MS) {
      last.endMs = Math.max(last.endMs, u.endMs);
      last.text = `${last.text} ${u.text}`.trim();
    } else {
      merged.push({
        kind: 'speech',
        userId: u.userId,
        startMs: u.startMs,
        endMs: u.endMs,
        text: u.text.trim(),
      });
    }
  }
  return merged;
}

export function buildTimeline(input: TimelineInput): {
  speakers: Speaker[];
  entries: TimelineEntry[];
} {
  const speech = mergeSpeech(input.utterances);
  const chat: Raw[] = input.chat.map((c) => {
    const startMs = Math.max(0, c.createdAt.getTime() - input.meetingStartedAt.getTime());
    return { kind: 'chat', userId: c.userId, startMs, endMs: startMs, text: c.body };
  });
  const ordered = [...speech, ...chat]
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.startMs - b.entry.startMs || a.index - b.index)
    .map((x) => x.entry);

  const speakers: Speaker[] = [];
  const speakerByUser = new Map<string, Speaker>();
  let speechCount = 0;
  let chatCount = 0;
  const entries = ordered.map((raw): TimelineEntry => {
    let speaker = speakerByUser.get(raw.userId);
    if (!speaker) {
      speaker = {
        speakerId: `S${speakers.length + 1}`,
        userId: raw.userId,
        name: input.names.get(raw.userId) ?? raw.userId,
      };
      speakers.push(speaker);
      speakerByUser.set(raw.userId, speaker);
    }
    const refId = raw.kind === 'speech' ? `U${++speechCount}` : `C${++chatCount}`;
    return { ...raw, refId, speakerId: speaker.speakerId };
  });
  return { speakers, entries };
}

export function formatClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

export function formatTimelineForPrompt(t: {
  speakers: Speaker[];
  entries: TimelineEntry[];
}): string {
  const names = new Map(t.speakers.map((s) => [s.speakerId, s.name]));
  return t.entries
    .map((e) => {
      const tag = e.kind === 'chat' ? ' (chat)' : '';
      return `[${e.refId} ${formatClock(e.startMs)}] ${e.speakerId} ${names.get(e.speakerId) ?? ''}${tag}: ${e.text}`;
    })
    .join('\n');
}
