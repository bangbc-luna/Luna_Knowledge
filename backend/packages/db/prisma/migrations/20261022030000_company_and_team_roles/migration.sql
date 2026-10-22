ALTER TYPE "WorkspaceRole" ADD VALUE IF NOT EXISTS 'ADMIN';
ALTER TYPE "WorkspaceRole" ADD VALUE IF NOT EXISTS 'VIEWER';

CREATE TYPE "WorkspaceKind" AS ENUM ('COMPANY', 'TEAM');
ALTER TABLE "workspaces" ADD COLUMN "kind" "WorkspaceKind" NOT NULL DEFAULT 'TEAM';
UPDATE "workspaces" SET "kind" = 'COMPANY' WHERE "slug" = 'lunatech' AND "deleted_at" IS NULL;
CREATE UNIQUE INDEX "workspaces_single_company" ON "workspaces"("kind") WHERE ("kind" = 'COMPANY' AND "deleted_at" IS NULL);
