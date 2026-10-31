DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM blobs GROUP BY provider, container, key HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'blobs: several rows share one object key, resolve them before deploying';
  END IF;
END $$;

UPDATE videos SET poster_blob_id = NULL
 WHERE poster_blob_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM blobs b WHERE b.id = videos.poster_blob_id);

UPDATE videos SET sprite_blob_id = NULL
 WHERE sprite_blob_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM blobs b WHERE b.id = videos.sprite_blob_id);

UPDATE documents SET last_edited_by = NULL
 WHERE last_edited_by IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = documents.last_edited_by);

UPDATE document_versions SET restored_from_id = NULL
 WHERE restored_from_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM document_versions d WHERE d.id = document_versions.restored_from_id);

CREATE UNIQUE INDEX "blobs_provider_container_key_key" ON "blobs"("provider", "container", "key");

CREATE INDEX "document_versions_restored_from_id_idx" ON "document_versions"("restored_from_id") WHERE (restored_from_id IS NOT NULL);

CREATE INDEX "documents_last_edited_by_idx" ON "documents"("last_edited_by");

CREATE INDEX "videos_version_id_idx" ON "videos"("version_id");

CREATE INDEX "videos_hls_blob_id_idx" ON "videos"("hls_blob_id");

CREATE INDEX "videos_poster_blob_id_idx" ON "videos"("poster_blob_id");

CREATE INDEX "videos_sprite_blob_id_idx" ON "videos"("sprite_blob_id");

ALTER TABLE "videos" ADD CONSTRAINT "videos_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "file_versions"("id") ON DELETE NO ACTION ON UPDATE CASCADE NOT VALID;

ALTER TABLE "videos" ADD CONSTRAINT "videos_hls_blob_id_fkey" FOREIGN KEY ("hls_blob_id") REFERENCES "blobs"("id") ON DELETE NO ACTION ON UPDATE CASCADE NOT VALID;

ALTER TABLE "videos" ADD CONSTRAINT "videos_poster_blob_id_fkey" FOREIGN KEY ("poster_blob_id") REFERENCES "blobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "videos" ADD CONSTRAINT "videos_sprite_blob_id_fkey" FOREIGN KEY ("sprite_blob_id") REFERENCES "blobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "documents" ADD CONSTRAINT "documents_last_edited_by_fkey" FOREIGN KEY ("last_edited_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_restored_from_id_fkey" FOREIGN KEY ("restored_from_id") REFERENCES "document_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM videos v WHERE NOT EXISTS (SELECT 1 FROM blobs b WHERE b.id = v.hls_blob_id)) THEN
    ALTER TABLE videos VALIDATE CONSTRAINT videos_hls_blob_id_fkey;
  ELSE
    RAISE WARNING 'videos.hls_blob_id has orphans; constraint left NOT VALID';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM videos v WHERE NOT EXISTS (SELECT 1 FROM file_versions f WHERE f.id = v.version_id)) THEN
    ALTER TABLE videos VALIDATE CONSTRAINT videos_version_id_fkey;
  ELSE
    RAISE WARNING 'videos.version_id has orphans; constraint left NOT VALID';
  END IF;
END $$;
