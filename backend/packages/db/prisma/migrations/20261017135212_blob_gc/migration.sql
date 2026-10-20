-- CreateTable
CREATE TABLE "blob_gc" (
    "id" BIGSERIAL NOT NULL,
    "provider" "StorageProvider" NOT NULL,
    "container" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blob_gc_pkey" PRIMARY KEY ("id")
);

-- Mọi blob bị xoá (trực tiếp hoặc dây chuyền từ nodes) đều được đưa vào hàng đợi dọn object.
CREATE FUNCTION blobs_enqueue_gc() RETURNS trigger AS $$
BEGIN
  INSERT INTO blob_gc (provider, container, key) VALUES (OLD.provider, OLD.container, OLD.key);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER blobs_enqueue_gc
  AFTER DELETE ON blobs
  FOR EACH ROW EXECUTE FUNCTION blobs_enqueue_gc();
