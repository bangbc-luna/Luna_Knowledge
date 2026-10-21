-- CreateEnum
CREATE TYPE "ThreadStatus" AS ENUM ('OPEN', 'RESOLVED');

-- AlterEnum
ALTER TYPE "BlobKind" ADD VALUE 'ASSET';

-- CreateTable
CREATE TABLE "documents" (
    "node_id" UUID NOT NULL,
    "yjs_state" BYTEA,
    "content_json" JSONB,
    "content_text" TEXT,
    "word_count" INTEGER NOT NULL DEFAULT 0,
    "last_edited_at" TIMESTAMPTZ(3),
    "last_edited_by" UUID,
    "last_version_at" TIMESTAMPTZ(3),
    "dirty_since_version" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("node_id")
);

-- CreateTable
CREATE TABLE "document_versions" (
    "id" UUID NOT NULL,
    "node_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "name" TEXT,
    "is_auto" BOOLEAN NOT NULL DEFAULT false,
    "restored_from_id" UUID,
    "yjs_snapshot" BYTEA NOT NULL,
    "content_json" JSONB NOT NULL,
    "content_text" TEXT NOT NULL,
    "word_count" INTEGER NOT NULL DEFAULT 0,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comment_threads" (
    "id" UUID NOT NULL,
    "node_id" UUID NOT NULL,
    "quoted_text" TEXT NOT NULL,
    "status" "ThreadStatus" NOT NULL DEFAULT 'OPEN',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_by" UUID,
    "resolved_at" TIMESTAMPTZ(3),

    CONSTRAINT "comment_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" UUID NOT NULL,
    "thread_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "mentions" UUID[] DEFAULT ARRAY[]::UUID[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "edited_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_assets" (
    "id" UUID NOT NULL,
    "node_id" UUID NOT NULL,
    "blob_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_node_id_version_no_key" ON "document_versions"("node_id", "version_no");

-- CreateIndex
CREATE INDEX "comment_threads_node_id_status_idx" ON "comment_threads"("node_id", "status");

-- CreateIndex
CREATE INDEX "comments_thread_id_created_at_idx" ON "comments"("thread_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_created_at_idx" ON "notifications"("user_id", "read_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "document_assets_blob_id_key" ON "document_assets"("blob_id");

-- CreateIndex
CREATE INDEX "document_assets_node_id_idx" ON "document_assets"("node_id");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_threads" ADD CONSTRAINT "comment_threads_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_threads" ADD CONSTRAINT "comment_threads_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_threads" ADD CONSTRAINT "comment_threads_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "comment_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_assets" ADD CONSTRAINT "document_assets_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_assets" ADD CONSTRAINT "document_assets_blob_id_fkey" FOREIGN KEY ("blob_id") REFERENCES "blobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_assets" ADD CONSTRAINT "document_assets_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
