UPDATE "workspace_members" m SET "role" = 'VIEWER'
  FROM "workspaces" w WHERE w."id" = m."workspace_id" AND w."kind" = 'COMPANY';

UPDATE "workspace_members" m SET "role" = 'ADMIN'
  FROM "workspaces" w, "users" u
 WHERE w."id" = m."workspace_id" AND w."kind" = 'COMPANY' AND u."id" = m."user_id" AND u."is_system_admin";

INSERT INTO "workspace_members" ("workspace_id", "user_id", "role", "created_at")
SELECT w."id", u."id", 'VIEWER', now()
  FROM "workspaces" w CROSS JOIN "users" u
 WHERE w."kind" = 'COMPANY' AND w."deleted_at" IS NULL AND u."status" = 'ACTIVE'
ON CONFLICT DO NOTHING;

UPDATE "workspace_members" m SET "role" = 'ADMIN'
  FROM "workspaces" w
 WHERE w."id" = m."workspace_id" AND w."kind" = 'TEAM' AND m."user_id" = w."created_by";

UPDATE "workspace_members" m SET "role" = 'ADMIN'
 WHERE (m."workspace_id", m."user_id") IN (
   SELECT DISTINCT ON (x."workspace_id") x."workspace_id", x."user_id"
     FROM "workspace_members" x JOIN "workspaces" w ON w."id" = x."workspace_id"
    WHERE w."kind" = 'TEAM'
      AND NOT EXISTS (SELECT 1 FROM "workspace_members" a WHERE a."workspace_id" = x."workspace_id" AND a."role" = 'ADMIN')
    ORDER BY x."workspace_id", x."created_at");
