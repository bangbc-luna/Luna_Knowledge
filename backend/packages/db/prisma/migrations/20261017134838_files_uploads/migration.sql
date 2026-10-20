-- CreateEnum
CREATE TYPE "BlobKind" AS ENUM ('ORIGINAL', 'PREVIEW', 'THUMBNAIL');

-- CreateEnum
CREATE TYPE "StorageProvider" AS ENUM ('S3', 'GDRIVE');

-- CreateEnum
CREATE TYPE "UploadStatus" AS ENUM ('PENDING', 'COMPLETED', 'ABORTED');

-- CreateTable
CREATE TABLE "blobs" (
    "id" UUID NOT NULL,
    "node_id" UUID NOT NULL,
    "kind" "BlobKind" NOT NULL,
    "provider" "StorageProvider" NOT NULL,
    "container" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "mime" TEXT NOT NULL,
    "sha256" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "files" (
    "node_id" UUID NOT NULL,
    "current_version_id" UUID,
    "extracted_text" TEXT,
    "extracted_at" TIMESTAMPTZ(3),
    "processing_error" TEXT,

    CONSTRAINT "files_pkey" PRIMARY KEY ("node_id")
);

-- CreateTable
CREATE TABLE "file_versions" (
    "id" UUID NOT NULL,
    "node_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "file_name" TEXT NOT NULL,
    "original_blob_id" UUID NOT NULL,
    "preview_blob_id" UUID,
    "thumbnail_blob_id" UUID,
    "preview_kind" TEXT NOT NULL DEFAULT 'none',
    "uploaded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upload_sessions" (
    "id" UUID NOT NULL,
    "node_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "s3_upload_id" TEXT NOT NULL,
    "tmp_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "part_size" INTEGER NOT NULL,
    "part_count" INTEGER NOT NULL,
    "mime_declared" TEXT NOT NULL,
    "is_new_version" BOOLEAN NOT NULL DEFAULT false,
    "status" "UploadStatus" NOT NULL DEFAULT 'PENDING',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "upload_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "blobs_node_id_idx" ON "blobs"("node_id");

-- CreateIndex
CREATE UNIQUE INDEX "files_current_version_id_key" ON "files"("current_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "file_versions_node_id_version_no_key" ON "file_versions"("node_id", "version_no");

-- CreateIndex
CREATE INDEX "upload_sessions_status_expires_at_idx" ON "upload_sessions"("status", "expires_at");

-- AddForeignKey
ALTER TABLE "blobs" ADD CONSTRAINT "blobs_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "file_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_original_blob_id_fkey" FOREIGN KEY ("original_blob_id") REFERENCES "blobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_preview_blob_id_fkey" FOREIGN KEY ("preview_blob_id") REFERENCES "blobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_thumbnail_blob_id_fkey" FOREIGN KEY ("thumbnail_blob_id") REFERENCES "blobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
