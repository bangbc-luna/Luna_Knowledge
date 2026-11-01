import { MEETING_MEDIA, type MeetingMedia, roomNameFor } from '@luna/meetings';
import { Inject, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { AppError } from '../common/errors/app-error.js';
import { decodeKeysetCursor, encodeKeysetCursor, type Page } from '../common/pagination/cursor.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { MeetingAccess } from './meeting-access.service.js';
import type { ChatMessageDto, ListMessagesQuery, SendMessageBody } from './meetings.schemas.js';

const CHAT_CLOSED = 'Chat is only open while the meeting is live';
const TIMELINE_BATCH = 500;
const TIMELINE_MAX = 10_000;
const author = { id: true, email: true, name: true, avatarUrl: true } as const;

interface MessageRow {
  id: string;
  body: string;
  createdAt: Date;
  user: { id: string; email: string; name: string; avatarUrl: string | null };
}

const toDto = (m: MessageRow): ChatMessageDto => ({
  id: m.id,
  body: m.body,
  createdAt: m.createdAt,
  author: m.user,
});

@Injectable()
export class MeetingChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: MeetingAccess,
    @Inject(MEETING_MEDIA) private readonly media: MeetingMedia,
  ) {}

  async send(
    user: AuthenticatedUser,
    meetingId: string,
    body: SendMessageBody,
  ): Promise<ChatMessageDto> {
    await this.access.require(user, meetingId);
    const row = await this.prisma.client.$transaction(async (tx) => {
      const status = await tx.$queryRaw<{ status: string }[]>`SELECT status::text
        FROM meetings WHERE id = ${meetingId}::uuid FOR SHARE`;
      if (status[0]?.status !== 'LIVE') throw AppError.conflict(CHAT_CLOSED);
      return tx.meetingChatMessage.create({
        data: { meetingId, userId: user.id, body: body.body },
        include: { user: { select: author } },
      });
    });
    const dto = toDto(row);
    try {
      await this.media.broadcast(roomNameFor(meetingId), 'luna.chat', dto);
    } catch (err) {
      console.error('meeting chat broadcast failed', { meetingId, messageId: dto.id, err });
    }
    return dto;
  }

  async list(
    user: AuthenticatedUser,
    meetingId: string,
    q: ListMessagesQuery,
  ): Promise<Page<ChatMessageDto>> {
    await this.access.require(user, meetingId);
    const cursor = q.cursor ? decodeKeysetCursor(q.cursor) : null;
    const rows = await this.prisma.client.meetingChatMessage.findMany({
      where: {
        meetingId,
        ...(cursor
          ? {
              OR: [
                { createdAt: { gt: cursor.at } },
                { createdAt: cursor.at, id: { gt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: q.limit + 1,
      include: { user: { select: author } },
    });
    const hasMore = rows.length > q.limit;
    const items = hasMore ? rows.slice(0, q.limit) : rows;
    const last = items[items.length - 1];
    return {
      items: items.map(toDto),
      nextCursor: hasMore && last ? encodeKeysetCursor(last.createdAt, last.id) : null,
    };
  }

  async timeline(
    meetingId: string,
  ): Promise<Array<{ userId: string; body: string; createdAt: Date }>> {
    const out: Array<{ userId: string; body: string; createdAt: Date }> = [];
    let cursor: { at: Date; id: string } | null = null;
    while (out.length < TIMELINE_MAX) {
      const rows: Array<{ id: string; userId: string; body: string; createdAt: Date }> =
        await this.prisma.client.meetingChatMessage.findMany({
          where: {
            meetingId,
            ...(cursor
              ? {
                  OR: [
                    { createdAt: { gt: cursor.at } },
                    { createdAt: cursor.at, id: { gt: cursor.id } },
                  ],
                }
              : {}),
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: Math.min(TIMELINE_BATCH, TIMELINE_MAX - out.length),
          select: { id: true, userId: true, body: true, createdAt: true },
        });
      for (const r of rows) out.push({ userId: r.userId, body: r.body, createdAt: r.createdAt });
      const last = rows[rows.length - 1];
      if (!last || rows.length < TIMELINE_BATCH) break;
      cursor = { at: last.createdAt, id: last.id };
    }
    return out;
  }
}
