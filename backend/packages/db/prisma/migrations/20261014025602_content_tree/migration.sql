-- CreateEnum
CREATE TYPE "NodeType" AS ENUM ('FOLDER', 'DOCUMENT', 'FILE', 'VIDEO');

-- CreateEnum
CREATE TYPE "NodeStatus" AS ENUM ('UPLOADING', 'PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "ShareRole" AS ENUM ('EDITOR', 'VIEWER');

-- CreateTable
CREATE TABLE "nodes" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "parent_id" UUID,
    "type" "NodeType" NOT NULL,
    "name" TEXT NOT NULL,
    "name_normalized" TEXT NOT NULL,
    "path" ltree,
    "status" "NodeStatus" NOT NULL DEFAULT 'READY',
    "created_by" UUID NOT NULL,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" UUID,
    "deleted_root_id" UUID,

    CONSTRAINT "nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "node_shares" (
    "id" UUID NOT NULL,
    "node_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "ShareRole" NOT NULL,
    "granted_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "node_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "node_tags" (
    "node_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,

    CONSTRAINT "node_tags_pkey" PRIMARY KEY ("node_id","tag_id")
);

-- CreateTable
CREATE TABLE "favorites" (
    "user_id" UUID NOT NULL,
    "node_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorites_pkey" PRIMARY KEY ("user_id","node_id")
);

-- CreateTable
CREATE TABLE "recent_views" (
    "user_id" UUID NOT NULL,
    "node_id" UUID NOT NULL,
    "viewed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recent_views_pkey" PRIMARY KEY ("user_id","node_id")
);

-- CreateIndex
CREATE INDEX "nodes_path_idx" ON "nodes" USING GIST ("path");

-- CreateIndex
CREATE INDEX "nodes_parent_id_idx" ON "nodes"("parent_id");

-- CreateIndex
CREATE INDEX "nodes_workspace_id_deleted_root_id_idx" ON "nodes"("workspace_id", "deleted_root_id");

-- CreateIndex
CREATE UNIQUE INDEX "nodes_unique_name_in_folder" ON "nodes"("parent_id", "name_normalized") WHERE (deleted_at IS NULL AND parent_id IS NOT NULL);

-- CreateIndex
CREATE UNIQUE INDEX "nodes_unique_name_at_root" ON "nodes"("workspace_id", "name_normalized") WHERE (deleted_at IS NULL AND parent_id IS NULL);

-- CreateIndex
CREATE INDEX "node_shares_user_id_idx" ON "node_shares"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "node_shares_node_id_user_id_key" ON "node_shares"("node_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "tags_workspace_id_name_key" ON "tags"("workspace_id", "name");

-- CreateIndex
CREATE INDEX "node_tags_tag_id_idx" ON "node_tags"("tag_id");

-- CreateIndex
CREATE INDEX "recent_views_user_id_viewed_at_idx" ON "recent_views"("user_id", "viewed_at" DESC);

-- AddForeignKey
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "node_shares" ADD CONSTRAINT "node_shares_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "node_shares" ADD CONSTRAINT "node_shares_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "node_shares" ADD CONSTRAINT "node_shares_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "tags_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "node_tags" ADD CONSTRAINT "node_tags_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "node_tags" ADD CONSTRAINT "node_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recent_views" ADD CONSTRAINT "recent_views_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recent_views" ADD CONSTRAINT "recent_views_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Đường dẫn ltree của cây nội dung: DB tự tính, app không ghi trực tiếp.
-- Nhãn của mỗi node là id bỏ dấu gạch (ltree chỉ nhận [A-Za-z0-9_]).
-- ---------------------------------------------------------------------------

CREATE FUNCTION nodes_set_path() RETURNS trigger AS $$
DECLARE
  parent_path ltree;
  label ltree := text2ltree(replace(NEW.id::text, '-', ''));
BEGIN
  IF NEW.parent_id IS NULL THEN
    NEW.path := label;
  ELSE
    SELECT path INTO parent_path FROM nodes WHERE id = NEW.parent_id;
    IF parent_path IS NULL THEN
      RAISE EXCEPTION 'Parent node % not found', NEW.parent_id;
    END IF;
    NEW.path := parent_path || label;
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

-- Khi tạo node, hoặc khi đổi parent_id (di chuyển).
CREATE TRIGGER nodes_path_on_insert
  BEFORE INSERT ON nodes
  FOR EACH ROW EXECUTE FUNCTION nodes_set_path();

CREATE TRIGGER nodes_path_on_move
  BEFORE UPDATE OF parent_id ON nodes
  FOR EACH ROW
  WHEN (OLD.parent_id IS DISTINCT FROM NEW.parent_id)
  EXECUTE FUNCTION nodes_set_path();

-- Sau khi một node đổi path, cập nhật path của toàn bộ cây con trong một câu lệnh.
-- Bỏ qua khi trigger được gọi lồng (các node con đang được chính hàm này cập nhật).
CREATE FUNCTION nodes_move_subtree() RETURNS trigger AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NULL;
  END IF;
  UPDATE nodes
     SET path = NEW.path || subpath(path, nlevel(OLD.path))
   WHERE path <@ OLD.path AND id <> NEW.id;
  RETURN NULL;
END
$$ LANGUAGE plpgsql;

-- Không dùng "UPDATE OF path": trigger theo cột chỉ chạy khi cột có trong câu SET,
-- còn ở đây path được đổi bởi trigger BEFORE (nodes_path_on_move).
CREATE TRIGGER nodes_path_cascade
  AFTER UPDATE ON nodes
  FOR EACH ROW
  WHEN (OLD.path IS DISTINCT FROM NEW.path)
  EXECUTE FUNCTION nodes_move_subtree();
