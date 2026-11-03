import { api } from "./api";
import type { ApiOk } from "./api-types";
import type { paths } from "./api-schema";
import { linkify } from "./linkify";
import type { LinkPart } from "./linkify";

export type MeetingScope = "upcoming" | "live" | "past";
export type MeetingList = ApiOk<"/api/v1/workspaces/{wsId}/meetings", "get">;
export type MeetingSummary = MeetingList["items"][number];
export type MeetingDetail = ApiOk<"/api/v1/meetings/{id}", "get">;
export type MeetingJoin = ApiOk<"/api/v1/meetings/{id}/join", "post">;
export type MeetingChatPage = ApiOk<"/api/v1/meetings/{id}/messages", "get">;
export type MeetingChatMessage = MeetingChatPage["items"][number];
export type CreateMeetingInput = NonNullable<
  paths["/api/v1/workspaces/{wsId}/meetings"]["post"]["requestBody"]
>["content"]["application/json"];
export type CreatedMeeting = ApiOk<"/api/v1/workspaces/{wsId}/meetings", "post">;

export type UpdateMeetingInput = NonNullable<
  paths["/api/v1/meetings/{id}"]["patch"]["requestBody"]
>["content"]["application/json"];
export type InvitesAdded = ApiOk<"/api/v1/meetings/{id}/invites", "post">;

export type MeetingMinutes = ApiOk<"/api/v1/meetings/{id}/minutes", "get">;
export type MinutesDraft = NonNullable<MeetingMinutes["draft"]>;
export type MinutesSuggestion = MinutesDraft["suggestions"][number];
export type MinutesStatus = MeetingMinutes["status"];

export const meetingHref = (wsId: string, meetingId: string) => `/w/${wsId}/meetings/${meetingId}`;

export const listMeetings = (wsId: string, scope: MeetingScope, cursor?: string, limit?: number) =>
  api<MeetingList>(`/workspaces/${wsId}/meetings`, { query: { scope, cursor, limit } });

export const createMeeting = (wsId: string, input: CreateMeetingInput) =>
  api<CreatedMeeting>(`/workspaces/${wsId}/meetings`, { method: "POST", body: input });

export const getMeeting = (meetingId: string) => api<MeetingDetail>(`/meetings/${meetingId}`);

export const joinMeeting = (meetingId: string) => api<MeetingJoin>(`/meetings/${meetingId}/join`, { method: "POST" });

export const endMeeting = (meetingId: string) => api<void>(`/meetings/${meetingId}/end`, { method: "POST" });

export const muteParticipant = (meetingId: string, userId: string) =>
  api<ApiOk<"/api/v1/meetings/{id}/participants/{userId}/mute", "post">>(
    `/meetings/${meetingId}/participants/${userId}/mute`,
    { method: "POST" },
  );

export const setAiNotes = (meetingId: string, enabled: boolean) =>
  api<ApiOk<"/api/v1/meetings/{id}/ai-notes", "put">>(`/meetings/${meetingId}/ai-notes`, {
    method: "PUT",
    body: { enabled },
  });

export const updateMeeting = (meetingId: string, input: UpdateMeetingInput) =>
  api<MeetingDetail>(`/meetings/${meetingId}`, { method: "PATCH", body: input });

export const cancelMeeting = (meetingId: string) => api<void>(`/meetings/${meetingId}/cancel`, { method: "POST" });

export const inviteToMeeting = (meetingId: string, emails: string[]) =>
  api<InvitesAdded>(`/meetings/${meetingId}/invites`, { method: "POST", body: { emails } });

export const uninviteFromMeeting = (meetingId: string, userId: string) =>
  api<void>(`/meetings/${meetingId}/invites/${userId}`, { method: "DELETE" });

export const setHandRaised = (meetingId: string, raised: boolean) =>
  api<ApiOk<"/api/v1/meetings/{id}/hand", "put">>(`/meetings/${meetingId}/hand`, { method: "PUT", body: { raised } });

export const sendChat = (meetingId: string, body: string) =>
  api<MeetingChatMessage>(`/meetings/${meetingId}/messages`, { method: "POST", body: { body } });

export const listChat = (meetingId: string, cursor?: string, limit?: number) =>
  api<MeetingChatPage>(`/meetings/${meetingId}/messages`, { query: { cursor, limit } });

export const getMinutes = (meetingId: string) => api<MeetingMinutes>(`/meetings/${meetingId}/minutes`);

export const saveMinutesDraft = (meetingId: string, doc: Record<string, unknown>, revision: number) =>
  api<ApiOk<"/api/v1/meetings/{id}/minutes/draft", "put">>(`/meetings/${meetingId}/minutes/draft`, {
    method: "PUT",
    body: { doc, revision },
  });

export const publishMinutes = (meetingId: string, revision: number, confirmedUserIds: string[]) =>
  api<ApiOk<"/api/v1/meetings/{id}/minutes/publish", "post">>(`/meetings/${meetingId}/minutes/publish`, {
    method: "POST",
    body: { revision, confirmedUserIds },
  });

export const retryMinutes = (meetingId: string) => api<void>(`/meetings/${meetingId}/minutes/retry`, { method: "POST" });

export { linkify };
export type { LinkPart };

export type MeetingUsage = ApiOk<"/api/v1/admin/meetings/usage", "get">;

export const getMeetingUsage = (from: string, to: string) => api<MeetingUsage>("/admin/meetings/usage", { query: { from, to } });
