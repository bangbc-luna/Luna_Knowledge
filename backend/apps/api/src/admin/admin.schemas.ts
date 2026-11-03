import { z } from 'zod';
import { userSummarySchema } from '../users/users.schemas.js';

const csvList = z
  .string()
  .optional()
  .transform((v) =>
    v
      ? v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined,
  );

export const auditQuery = z.object({
  actorId: z.uuid().optional().describe('Người thực hiện'),
  actions: csvList.describe(
    'Danh sách hành động, phân tách bằng dấu phẩy (vd: node.view,share.add)',
  ),
  workspaceId: z.uuid().optional(),
  targetId: z.string().max(100).optional().describe('Id đối tượng (mục, workspace, user…)'),
  from: z.coerce.date().optional().describe('Từ thời điểm (ISO 8601)'),
  to: z.coerce.date().optional().describe('Đến thời điểm (ISO 8601)'),
  cursor: z.string().regex(/^\d+$/).optional().describe('nextCursor của trang trước'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const auditItemSchema = z.object({
  id: z.string(),
  createdAt: z.date(),
  action: z.string(),
  actor: userSummarySchema.nullable().describe('null: hệ thống / không xác định'),
  target: z
    .object({
      type: z.string(),
      id: z.string(),
      label: z.string().nullable().describe('Tên mục / workspace / email; null nếu đã bị xoá hẳn'),
    })
    .nullable(),
  workspace: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  metadata: z.unknown().nullable(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
});

export const statsSchema = z.object({
  users: z.object({
    total: z.number().int(),
    active: z.number().int(),
    disabled: z.number().int(),
    systemAdmins: z.number().int(),
    activeLast7Days: z.number().int().describe('Số người có hoạt động trong 7 ngày'),
  }),
  workspaces: z.object({ total: z.number().int() }),
  content: z.object({
    folders: z.number().int(),
    documents: z.number().int(),
    files: z.number().int(),
    videos: z.number().int(),
    inTrash: z.number().int(),
  }),
  activity: z.object({
    last7Days: z.array(z.object({ date: z.string(), count: z.number().int() })),
    loginsLast7Days: z.number().int(),
    failedLoginsLast7Days: z.number().int(),
  }),
});

const monthString = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Định dạng YYYY-MM');
const MAX_USAGE_MONTHS = 24;
const monthIndex = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7));

export const meetingUsageQuery = z
  .object({
    from: monthString.describe('Từ tháng (YYYY-MM, giờ Asia/Ho_Chi_Minh)'),
    to: monthString.describe('Đến tháng, gồm cả tháng này (YYYY-MM)'),
  })
  .refine((q) => monthIndex(q.to) >= monthIndex(q.from), { message: 'to phải sau hoặc bằng from' })
  .refine((q) => monthIndex(q.to) - monthIndex(q.from) < MAX_USAGE_MONTHS, {
    message: `Tối đa ${MAX_USAGE_MONTHS} tháng`,
  });

export const meetingUsageSchema = z.object({
  months: z.array(
    z.object({
      month: z.string().describe('YYYY-MM, theo thời điểm bắt đầu họp (Asia/Ho_Chi_Minh)'),
      meetings: z.number().int().describe('Số buổi họp đã bắt đầu (đang diễn ra hoặc đã kết thúc)'),
      roomMinutes: z.number().int().describe('Tổng phút phòng họp của các buổi đã kết thúc'),
      participantMinutes: z.number().int().describe('Tổng phút tham dự của các phiên đã đóng'),
      sttMinutes: z.number().describe('Tổng phút âm thanh đã chép lời (làm tròn 2 chữ số)'),
      llmInputTokens: z.number().int(),
      llmOutputTokens: z.number().int(),
      aiCostMicroUsd: z.number().int().describe('Tổng chi phí AI, đơn vị micro USD'),
      aiCostUsd: z.number().describe('Tổng chi phí AI, USD'),
      liveKitEstimateUsd: z
        .number()
        .describe('Ước tính chi phí LiveKit theo phút tham dự; gói cố định không tính'),
      byWorkspace: z.array(
        z.object({
          workspaceId: z.uuid(),
          name: z.string(),
          meetings: z.number().int(),
          participantMinutes: z.number().int(),
        }),
      ),
    }),
  ),
});

export type MeetingUsageQuery = z.output<typeof meetingUsageQuery>;
export type AuditQuery = z.output<typeof auditQuery>;
