CREATE TYPE "WorkspaceRole_new" AS ENUM ('MEMBER');
ALTER TABLE "workspace_members" ALTER COLUMN "role" TYPE "WorkspaceRole_new" USING ('MEMBER'::"WorkspaceRole_new");
DROP TYPE "WorkspaceRole";
ALTER TYPE "WorkspaceRole_new" RENAME TO "WorkspaceRole";

CREATE TYPE "NodeSection" AS ENUM ('DOCS', 'VIDEOS');
ALTER TABLE "nodes" ADD COLUMN "section" "NodeSection" NOT NULL DEFAULT 'DOCS';

UPDATE "nodes" SET "section" = 'VIDEOS' WHERE "type" = 'VIDEO';

DROP INDEX "nodes_unique_name_at_root";
CREATE UNIQUE INDEX "nodes_unique_name_at_root" ON "nodes"("workspace_id", "section", "name_normalized") WHERE (deleted_at IS NULL AND parent_id IS NULL);

UPDATE "nodes" v
   SET "parent_id" = NULL,
       "name" = v."name" || ' (' || left(v."id"::text, 8) || ')',
       "name_normalized" = v."name_normalized" || ' (' || left(v."id"::text, 8) || ')'
  FROM "nodes" p
 WHERE v."type" = 'VIDEO' AND v."parent_id" = p."id" AND p."section" = 'DOCS'
   AND EXISTS (
     SELECT 1 FROM "nodes" o
      WHERE o."workspace_id" = v."workspace_id" AND o."parent_id" IS NULL AND o."section" = 'VIDEOS'
        AND o."deleted_at" IS NULL AND o."name_normalized" = v."name_normalized" AND o."id" <> v."id");

UPDATE "nodes" v
   SET "parent_id" = NULL
  FROM "nodes" p
 WHERE v."type" = 'VIDEO' AND v."parent_id" = p."id" AND p."section" = 'DOCS';

ALTER TABLE "document_versions" ADD COLUMN "words_added" INTEGER NOT NULL DEFAULT 0,
                                ADD COLUMN "words_removed" INTEGER NOT NULL DEFAULT 0;
