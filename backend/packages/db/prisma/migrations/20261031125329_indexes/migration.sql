DROP INDEX "audit_logs_action_created_at_idx";

DROP INDEX "audit_logs_actor_id_created_at_idx";

DROP INDEX "audit_logs_workspace_id_created_at_idx";

DROP INDEX "nodes_workspace_id_deleted_root_id_idx";

DROP INDEX "notifications_user_id_read_at_created_at_idx";

CREATE INDEX "audit_logs_target_id_id_idx" ON "audit_logs"("target_id", "id" DESC);

CREATE INDEX "audit_logs_workspace_id_id_idx" ON "audit_logs"("workspace_id", "id" DESC);

CREATE INDEX "audit_logs_actor_id_id_idx" ON "audit_logs"("actor_id", "id" DESC);

CREATE INDEX "audit_logs_action_id_idx" ON "audit_logs"("action", "id" DESC);

CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs" USING BRIN ("created_at");

CREATE INDEX "favorites_node_id_idx" ON "favorites"("node_id");

CREATE INDEX "file_versions_original_blob_id_idx" ON "file_versions"("original_blob_id");

CREATE INDEX "file_versions_preview_blob_id_idx" ON "file_versions"("preview_blob_id");

CREATE INDEX "file_versions_thumbnail_blob_id_idx" ON "file_versions"("thumbnail_blob_id");

CREATE INDEX "nodes_workspace_id_idx" ON "nodes"("workspace_id");

CREATE INDEX "nodes_deleted_root_id_idx" ON "nodes"("deleted_root_id") WHERE (deleted_root_id IS NOT NULL);

CREATE INDEX "notifications_user_id_id_idx" ON "notifications"("user_id", "id" DESC);

CREATE INDEX "notifications_unread_idx" ON "notifications"("user_id") WHERE (read_at IS NULL);

CREATE INDEX "recent_views_node_id_idx" ON "recent_views"("node_id");

CREATE INDEX "upload_sessions_node_id_idx" ON "upload_sessions"("node_id");

CREATE INDEX "video_watch_progress_node_id_idx" ON "video_watch_progress"("node_id");
