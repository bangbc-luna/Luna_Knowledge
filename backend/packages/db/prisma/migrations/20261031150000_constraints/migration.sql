WITH RECURSIVE t AS (
  SELECT id, text2ltree(replace(id::text, '-', '')) AS p
    FROM nodes WHERE parent_id IS NULL
  UNION ALL
  SELECT n.id, t.p || text2ltree(replace(n.id::text, '-', ''))
    FROM nodes n JOIN t ON n.parent_id = t.id
)
UPDATE nodes SET path = t.p FROM t WHERE nodes.id = t.id AND nodes.path IS NULL;

UPDATE nodes n
   SET deleted_root_id = COALESCE(
     (SELECT a.id FROM nodes a
       WHERE n.path <@ a.path AND a.id <> n.id
         AND a.deleted_at IS NOT NULL AND (a.deleted_root_id IS NULL OR a.deleted_root_id = a.id)
       ORDER BY nlevel(a.path) ASC LIMIT 1),
     n.id)
 WHERE n.deleted_at IS NOT NULL AND n.deleted_root_id IS NULL;

UPDATE nodes SET deleted_root_id = NULL WHERE deleted_at IS NULL AND deleted_root_id IS NOT NULL;

UPDATE comments SET mentions = '{}' WHERE mentions IS NULL;

UPDATE comment_threads SET resolved_at = created_at
 WHERE status = 'RESOLVED' AND resolved_at IS NULL;
UPDATE comment_threads SET resolved_at = NULL, resolved_by = NULL
 WHERE status <> 'RESOLVED' AND (resolved_at IS NOT NULL OR resolved_by IS NOT NULL);

UPDATE blobs SET size_bytes = 0 WHERE size_bytes < 0;
UPDATE upload_sessions SET size_bytes = 0 WHERE size_bytes < 0;
UPDATE upload_sessions SET part_size = 1 WHERE part_size <= 0;
UPDATE upload_sessions SET part_count = 1 WHERE part_count <= 0;
UPDATE blob_gc SET attempts = 0 WHERE attempts < 0;
UPDATE documents SET word_count = 0 WHERE word_count < 0;
UPDATE document_versions SET word_count = 0 WHERE word_count < 0;
UPDATE document_versions SET words_added = 0 WHERE words_added < 0;
UPDATE document_versions SET words_removed = 0 WHERE words_removed < 0;
UPDATE videos SET duration_sec = 0 WHERE duration_sec < 0;
UPDATE videos SET width = 0 WHERE width < 0;
UPDATE videos SET height = 0 WHERE height < 0;
UPDATE videos SET view_count = 0 WHERE view_count < 0;
UPDATE video_watch_progress SET position_sec = 0 WHERE position_sec < 0;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM file_versions WHERE version_no <= 0)
     OR EXISTS (SELECT 1 FROM document_versions WHERE version_no <= 0) THEN
    RAISE EXCEPTION 'versions: non-positive version_no found, renumber them before deploying';
  END IF;
END $$;

ALTER TABLE nodes ADD CONSTRAINT nodes_path_present CHECK (path IS NOT NULL);
ALTER TABLE nodes ADD CONSTRAINT nodes_trash_consistent CHECK ((deleted_at IS NULL) = (deleted_root_id IS NULL));
ALTER TABLE comments ALTER COLUMN mentions SET NOT NULL;
ALTER TABLE comment_threads ADD CONSTRAINT comment_threads_resolved_consistent
  CHECK ((status = 'RESOLVED') = (resolved_at IS NOT NULL));
ALTER TABLE blobs ADD CONSTRAINT blobs_size_bytes_nonnegative CHECK (size_bytes >= 0);
ALTER TABLE upload_sessions ADD CONSTRAINT upload_sessions_size_bytes_nonnegative CHECK (size_bytes >= 0);
ALTER TABLE upload_sessions ADD CONSTRAINT upload_sessions_part_size_nonnegative CHECK (part_size > 0);
ALTER TABLE upload_sessions ADD CONSTRAINT upload_sessions_part_count_nonnegative CHECK (part_count > 0);
ALTER TABLE file_versions ADD CONSTRAINT file_versions_version_no_nonnegative CHECK (version_no > 0);
ALTER TABLE document_versions ADD CONSTRAINT document_versions_version_no_nonnegative CHECK (version_no > 0);
ALTER TABLE document_versions ADD CONSTRAINT document_versions_word_count_nonnegative CHECK (word_count >= 0);
ALTER TABLE document_versions ADD CONSTRAINT document_versions_words_added_nonnegative CHECK (words_added >= 0);
ALTER TABLE document_versions ADD CONSTRAINT document_versions_words_removed_nonnegative CHECK (words_removed >= 0);
ALTER TABLE documents ADD CONSTRAINT documents_word_count_nonnegative CHECK (word_count >= 0);
ALTER TABLE videos ADD CONSTRAINT videos_duration_sec_nonnegative CHECK (duration_sec >= 0);
ALTER TABLE videos ADD CONSTRAINT videos_width_nonnegative CHECK (width >= 0);
ALTER TABLE videos ADD CONSTRAINT videos_height_nonnegative CHECK (height >= 0);
ALTER TABLE videos ADD CONSTRAINT videos_view_count_nonnegative CHECK (view_count >= 0);
ALTER TABLE video_watch_progress ADD CONSTRAINT video_watch_progress_position_sec_nonnegative CHECK (position_sec >= 0);
ALTER TABLE blob_gc ADD CONSTRAINT blob_gc_attempts_nonnegative CHECK (attempts >= 0);
