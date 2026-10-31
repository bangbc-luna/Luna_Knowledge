-- DropIndex
DROP INDEX "audit_logs_action_created_at_idx";

-- DropIndex
DROP INDEX "audit_logs_actor_id_created_at_idx";

-- DropIndex
DROP INDEX "audit_logs_workspace_id_created_at_idx";

-- DropIndex
DROP INDEX "nodes_workspace_id_deleted_root_id_idx";

-- DropIndex
DROP INDEX "notifications_user_id_read_at_created_at_idx";

-- CreateIndex
CREATE INDEX "audit_logs_target_id_id_idx" ON "audit_logs"("target_id", "id" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_workspace_id_id_idx" ON "audit_logs"("workspace_id", "id" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_id_idx" ON "audit_logs"("actor_id", "id" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_action_id_idx" ON "audit_logs"("action", "id" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs" USING BRIN ("created_at");

-- CreateIndex
CREATE INDEX "favorites_node_id_idx" ON "favorites"("node_id");

-- CreateIndex
CREATE INDEX "file_versions_original_blob_id_idx" ON "file_versions"("original_blob_id");

-- CreateIndex
CREATE INDEX "file_versions_preview_blob_id_idx" ON "file_versions"("preview_blob_id");

-- CreateIndex
CREATE INDEX "file_versions_thumbnail_blob_id_idx" ON "file_versions"("thumbnail_blob_id");

-- CreateIndex
CREATE INDEX "nodes_workspace_id_idx" ON "nodes"("workspace_id");

-- CreateIndex
CREATE INDEX "nodes_deleted_root_id_idx" ON "nodes"("deleted_root_id") WHERE (deleted_root_id IS NOT NULL);

-- CreateIndex
CREATE INDEX "notifications_user_id_id_idx" ON "notifications"("user_id", "id" DESC);

-- CreateIndex
CREATE INDEX "notifications_unread_idx" ON "notifications"("user_id") WHERE (read_at IS NULL);

-- CreateIndex
CREATE INDEX "recent_views_node_id_idx" ON "recent_views"("node_id");

-- CreateIndex
CREATE INDEX "upload_sessions_node_id_idx" ON "upload_sessions"("node_id");

-- CreateIndex
CREATE INDEX "video_watch_progress_node_id_idx" ON "video_watch_progress"("node_id");
