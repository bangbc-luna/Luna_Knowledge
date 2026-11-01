CREATE TYPE "MeetingStatus" AS ENUM ('SCHEDULED', 'LIVE', 'ENDED', 'CANCELLED');

CREATE TABLE "meetings" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "status" "MeetingStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduled_at" TIMESTAMPTZ(3),
    "started_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "end_reason" TEXT,
    "ai_notes_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "meeting_invites" (
    "meeting_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "invited_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_invites_pkey" PRIMARY KEY ("meeting_id","user_id")
);

CREATE TABLE "meeting_attendances" (
    "id" UUID NOT NULL,
    "meeting_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "joined_at" TIMESTAMPTZ(3) NOT NULL,
    "left_at" TIMESTAMPTZ(3),

    CONSTRAINT "meeting_attendances_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "meeting_chat_messages" (
    "id" UUID NOT NULL,
    "meeting_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_chat_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "meetings_workspace_id_status_scheduled_at_idx" ON "meetings"("workspace_id", "status", "scheduled_at");

CREATE INDEX "meetings_workspace_id_status_ended_at_id_idx" ON "meetings"("workspace_id", "status", "ended_at" DESC, "id" DESC);

CREATE INDEX "meetings_workspace_id_status_started_at_id_idx" ON "meetings"("workspace_id", "status", "started_at" DESC, "id" DESC);

CREATE INDEX "meetings_workspace_id_created_at_idx" ON "meetings"("workspace_id", "created_at" DESC);

CREATE INDEX "meetings_live_idx" ON "meetings"("status") WHERE (status = 'LIVE');

CREATE INDEX "meeting_invites_user_id_idx" ON "meeting_invites"("user_id");

CREATE INDEX "meeting_attendances_meeting_id_user_id_idx" ON "meeting_attendances"("meeting_id", "user_id");

CREATE UNIQUE INDEX "meeting_attendances_one_open" ON "meeting_attendances"("meeting_id", "user_id") WHERE (left_at IS NULL);

CREATE INDEX "meeting_chat_messages_meeting_id_created_at_idx" ON "meeting_chat_messages"("meeting_id", "created_at");

ALTER TABLE "meetings" ADD CONSTRAINT "meetings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "meetings" ADD CONSTRAINT "meetings_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "meeting_invites" ADD CONSTRAINT "meeting_invites_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "meeting_invites" ADD CONSTRAINT "meeting_invites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "meeting_invites" ADD CONSTRAINT "meeting_invites_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "meeting_attendances" ADD CONSTRAINT "meeting_attendances_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "meeting_attendances" ADD CONSTRAINT "meeting_attendances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "meeting_chat_messages" ADD CONSTRAINT "meeting_chat_messages_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "meeting_chat_messages" ADD CONSTRAINT "meeting_chat_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "meetings" ADD CONSTRAINT "meetings_title_len" CHECK (char_length(title) BETWEEN 1 AND 200);

ALTER TABLE "meetings" ADD CONSTRAINT "meetings_ended_after_started" CHECK (ended_at IS NULL OR started_at IS NULL OR ended_at >= started_at);

ALTER TABLE "meetings" ADD CONSTRAINT "meetings_scheduled_has_time" CHECK (status <> 'SCHEDULED' OR scheduled_at IS NOT NULL);

ALTER TABLE "meetings" ADD CONSTRAINT "meetings_started_has_time" CHECK (status NOT IN ('LIVE', 'ENDED') OR started_at IS NOT NULL);

ALTER TABLE "meetings" ADD CONSTRAINT "meetings_ended_has_time" CHECK (status <> 'ENDED' OR ended_at IS NOT NULL);

ALTER TABLE "meeting_attendances" ADD CONSTRAINT "meeting_attendances_left_after_join" CHECK (left_at IS NULL OR left_at >= joined_at);

ALTER TABLE "meeting_chat_messages" ADD CONSTRAINT "meeting_chat_body_len" CHECK (char_length(body) BETWEEN 1 AND 2000);
