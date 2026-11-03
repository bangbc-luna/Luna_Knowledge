CREATE TYPE "MinutesStatus" AS ENUM ('RECORDING', 'PROCESSING', 'AWAITING_REVIEW', 'PUBLISHING', 'PUBLISHED', 'FAILED');

CREATE TABLE "meeting_minutes" (
    "meeting_id" UUID NOT NULL,
    "status" "MinutesStatus" NOT NULL DEFAULT 'RECORDING',
    "audio_completed_at" TIMESTAMPTZ(3),
    "transcript_completed_at" TIMESTAMPTZ(3),
    "draft" JSONB,
    "draft_doc" JSONB,
    "draft_revision" INTEGER NOT NULL DEFAULT 0,
    "suggestions" JSONB,
    "dropped_item_count" INTEGER NOT NULL DEFAULT 0,
    "failed_stage" TEXT,
    "claimed_by" TEXT,
    "claim_expires_at" TIMESTAMPTZ(3),
    "error" TEXT,
    "document_node_id" UUID,
    "published_at" TIMESTAMPTZ(3),
    "published_by" UUID,
    "audio_purge_after" TIMESTAMPTZ(3),
    "audio_purged_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "meeting_minutes_pkey" PRIMARY KEY ("meeting_id")
);

CREATE TABLE "meeting_audio_chunks" (
    "id" UUID NOT NULL,
    "meeting_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "start_offset_ms" INTEGER NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "container" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "transcribed_at" TIMESTAMPTZ(3),
    "skipped_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_audio_chunks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "meeting_utterances" (
    "id" UUID NOT NULL,
    "meeting_id" UUID NOT NULL,
    "chunk_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "start_ms" INTEGER NOT NULL,
    "end_ms" INTEGER NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "meeting_utterances_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "meeting_ai_usage" (
    "id" BIGSERIAL NOT NULL,
    "meeting_id" UUID,
    "workspace_id" UUID,
    "kind" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "audio_ms" INTEGER NOT NULL DEFAULT 0,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_micro_usd" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_ai_usage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "meeting_minutes_status_idx" ON "meeting_minutes"("status");

CREATE INDEX "meeting_minutes_audio_purge_idx" ON "meeting_minutes"("audio_purge_after") WHERE (audio_purged_at IS NULL);

CREATE INDEX "meeting_audio_chunks_meeting_id_idx" ON "meeting_audio_chunks"("meeting_id");

CREATE UNIQUE INDEX "meeting_audio_chunks_meeting_id_user_id_start_offset_ms_key" ON "meeting_audio_chunks"("meeting_id", "user_id", "start_offset_ms");

CREATE INDEX "meeting_utterances_meeting_id_start_ms_idx" ON "meeting_utterances"("meeting_id", "start_ms");

CREATE INDEX "meeting_ai_usage_created_at_idx" ON "meeting_ai_usage" USING BRIN ("created_at");

CREATE INDEX "meeting_ai_usage_meeting_id_idx" ON "meeting_ai_usage"("meeting_id");

ALTER TABLE "meeting_minutes" ADD CONSTRAINT "meeting_minutes_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "meeting_minutes" ADD CONSTRAINT "meeting_minutes_document_node_id_fkey" FOREIGN KEY ("document_node_id") REFERENCES "nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "meeting_minutes" ADD CONSTRAINT "meeting_minutes_published_by_fkey" FOREIGN KEY ("published_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "meeting_audio_chunks" ADD CONSTRAINT "meeting_audio_chunks_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "meeting_audio_chunks" ADD CONSTRAINT "meeting_audio_chunks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "meeting_utterances" ADD CONSTRAINT "meeting_utterances_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "meeting_utterances" ADD CONSTRAINT "meeting_utterances_chunk_id_fkey" FOREIGN KEY ("chunk_id") REFERENCES "meeting_audio_chunks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "meeting_utterances" ADD CONSTRAINT "meeting_utterances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "meeting_ai_usage" ADD CONSTRAINT "meeting_ai_usage_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "meeting_ai_usage" ADD CONSTRAINT "meeting_ai_usage_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "meeting_audio_chunks" ADD CONSTRAINT "meeting_audio_chunks_offsets" CHECK (start_offset_ms >= 0 AND duration_ms > 0 AND size_bytes >= 0);

ALTER TABLE "meeting_utterances" ADD CONSTRAINT "meeting_utterances_range" CHECK (start_ms >= 0 AND end_ms >= start_ms AND char_length(text) > 0);

ALTER TABLE "meeting_ai_usage" ADD CONSTRAINT "meeting_ai_usage_kind" CHECK (kind IN ('stt', 'llm'));

ALTER TABLE "meeting_ai_usage" ADD CONSTRAINT "meeting_ai_usage_nonneg" CHECK (audio_ms >= 0 AND input_tokens >= 0 AND output_tokens >= 0 AND cost_micro_usd >= 0);

ALTER TABLE "meeting_minutes" ADD CONSTRAINT "meeting_minutes_revision" CHECK (draft_revision >= 0);

ALTER TABLE "meeting_minutes" ADD CONSTRAINT "meeting_minutes_published_has_doc" CHECK (status <> 'PUBLISHED' OR published_at IS NOT NULL);
