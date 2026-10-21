-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BlobKind" ADD VALUE 'HLS';
ALTER TYPE "BlobKind" ADD VALUE 'POSTER';
ALTER TYPE "BlobKind" ADD VALUE 'SPRITE';

-- CreateTable
CREATE TABLE "videos" (
    "node_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "duration_sec" DOUBLE PRECISION NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "renditions" JSONB NOT NULL,
    "hls_blob_id" UUID NOT NULL,
    "poster_blob_id" UUID,
    "sprite_blob_id" UUID,
    "sprite_vtt" TEXT,
    "key_encrypted" BYTEA NOT NULL,
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "transcoded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "videos_pkey" PRIMARY KEY ("node_id")
);

-- CreateTable
CREATE TABLE "video_watch_progress" (
    "user_id" UUID NOT NULL,
    "node_id" UUID NOT NULL,
    "position_sec" DOUBLE PRECISION NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "video_watch_progress_pkey" PRIMARY KEY ("user_id","node_id")
);

-- AddForeignKey
ALTER TABLE "videos" ADD CONSTRAINT "videos_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_watch_progress" ADD CONSTRAINT "video_watch_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_watch_progress" ADD CONSTRAINT "video_watch_progress_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
