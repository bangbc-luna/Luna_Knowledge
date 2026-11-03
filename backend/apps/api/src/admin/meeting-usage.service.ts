import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import type { MeetingUsageQuery } from './admin.schemas.js';

type Row = {
  month: string;
  workspace_id: string;
  name: string;
  meetings: number;
  room_minutes: number;
  participant_minutes: number;
};

type AiRow = {
  month: string;
  stt_ms: number;
  input_tokens: number;
  output_tokens: number;
  cost_micro_usd: number;
};

const VN_OFFSET = '+07:00';

const nextMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};

const monthRange = (from: string, to: string) => {
  const months: string[] = [];
  for (let m = from; m <= to; m = nextMonth(m)) months.push(m);
  return months;
};

@Injectable()
export class MeetingUsageService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async usage({ from, to }: MeetingUsageQuery) {
    const start = new Date(`${from}-01T00:00:00${VN_OFFSET}`);
    const end = new Date(`${nextMonth(to)}-01T00:00:00${VN_OFFSET}`);
    const rows = await this.prisma.client.$queryRaw<Row[]>`
      WITH m AS (
        SELECT id, workspace_id, status, started_at, ended_at,
               to_char(date_trunc('month', started_at AT TIME ZONE 'Asia/Ho_Chi_Minh'), 'YYYY-MM') AS month
          FROM meetings
         WHERE started_at >= ${start} AND started_at < ${end}
           AND status IN ('LIVE', 'ENDED')
      ),
      p AS (
        SELECT a.meeting_id,
               sum(ceil(extract(epoch FROM (a.left_at - a.joined_at)) / 60)) AS minutes
          FROM meeting_attendances a
          JOIN m ON m.id = a.meeting_id
         WHERE a.left_at IS NOT NULL
         GROUP BY a.meeting_id
      )
      SELECT m.month,
             m.workspace_id,
             w.name,
             count(*)::int AS meetings,
             coalesce(sum(CASE WHEN m.status = 'ENDED' AND m.ended_at IS NOT NULL
                               THEN ceil(extract(epoch FROM (m.ended_at - m.started_at)) / 60) END), 0)::int AS room_minutes,
             coalesce(sum(p.minutes), 0)::int AS participant_minutes
        FROM m
        JOIN workspaces w ON w.id = m.workspace_id
        LEFT JOIN p ON p.meeting_id = m.id
       GROUP BY m.month, m.workspace_id, w.name
       ORDER BY m.month, w.name, m.workspace_id`;

    const aiRows = await this.prisma.client.$queryRaw<AiRow[]>`
      SELECT to_char(date_trunc('month', coalesce(m.started_at, u.created_at) AT TIME ZONE 'Asia/Ho_Chi_Minh'), 'YYYY-MM') AS month,
             coalesce(sum(CASE WHEN u.kind = 'stt' THEN u.audio_ms END), 0)::float8 AS stt_ms,
             coalesce(sum(u.input_tokens) FILTER (WHERE u.kind = 'llm'), 0)::float8 AS input_tokens,
             coalesce(sum(u.output_tokens) FILTER (WHERE u.kind = 'llm'), 0)::float8 AS output_tokens,
             coalesce(sum(u.cost_micro_usd), 0)::float8 AS cost_micro_usd
        FROM meeting_ai_usage u
        LEFT JOIN meetings m ON m.id = u.meeting_id
       WHERE coalesce(m.started_at, u.created_at) >= ${start}
         AND coalesce(m.started_at, u.created_at) < ${end}
       GROUP BY 1`;

    const months = monthRange(from, to).map((month) => {
      const own = rows.filter((r) => r.month === month);
      const ai = aiRows.find((r) => r.month === month);
      const participantMinutes = own.reduce((s, r) => s + r.participant_minutes, 0);
      const aiCostMicroUsd = ai?.cost_micro_usd ?? 0;
      return {
        month,
        meetings: own.reduce((s, r) => s + r.meetings, 0),
        roomMinutes: own.reduce((s, r) => s + r.room_minutes, 0),
        participantMinutes,
        sttMinutes: Math.round(((ai?.stt_ms ?? 0) / 60000) * 100) / 100,
        llmInputTokens: ai?.input_tokens ?? 0,
        llmOutputTokens: ai?.output_tokens ?? 0,
        aiCostMicroUsd,
        aiCostUsd: aiCostMicroUsd / 1e6,
        liveKitEstimateUsd:
          Math.round(
            participantMinutes * this.config.MEETING_LIVEKIT_USD_PER_PARTICIPANT_MIN * 1e6,
          ) / 1e6,
        byWorkspace: own.map((r) => ({
          workspaceId: r.workspace_id,
          name: r.name,
          meetings: r.meetings,
          participantMinutes: r.participant_minutes,
        })),
      };
    });
    return { months };
  }
}
