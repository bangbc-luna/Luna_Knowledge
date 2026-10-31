DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'luna_app') THEN CREATE ROLE luna_app NOLOGIN; END IF;
END $$;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO luna_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO luna_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO luna_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO luna_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO luna_app;
DO $$ BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN REVOKE ALL ON "_prisma_migrations" FROM luna_app; END IF;
END $$;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM luna_app;

CREATE FUNCTION audit_logs_no_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only (TRUNCATE blocked)' USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_no_truncate();

CREATE FUNCTION purge_audit_logs(batch_size integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE removed integer;
BEGIN
  DELETE FROM audit_logs WHERE id IN (
    SELECT id FROM audit_logs WHERE created_at < now() - interval '1 year'
     ORDER BY id LIMIT LEAST(GREATEST(batch_size, 1), 10000));
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END $$;
REVOKE ALL ON FUNCTION purge_audit_logs(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_audit_logs(integer) TO luna_app;
