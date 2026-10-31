UPDATE nodes c
   SET deleted_at = a.deleted_at, deleted_by = a.deleted_by, deleted_root_id = a.deleted_root_id
  FROM (SELECT DISTINCT ON (c2.id) c2.id AS child_id, p.deleted_at, p.deleted_by, p.deleted_root_id
          FROM nodes c2 JOIN nodes p ON c2.path <@ p.path AND p.id <> c2.id
         WHERE c2.deleted_at IS NULL AND p.deleted_at IS NOT NULL
         ORDER BY c2.id, nlevel(p.path) DESC) a
 WHERE c.id = a.child_id;

CREATE OR REPLACE FUNCTION nodes_set_path() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  label ltree := text2ltree(replace(NEW.id::text, '-', ''));
  p_path ltree; p_type "NodeType"; p_ws uuid; p_section "NodeSection"; p_deleted timestamptz;
BEGIN
  IF NEW.parent_id IS NULL THEN
    NEW.path := label;
    RETURN NEW;
  END IF;
  SELECT path, type, workspace_id, section, deleted_at
    INTO p_path, p_type, p_ws, p_section, p_deleted
    FROM nodes WHERE id = NEW.parent_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tree: parent not found' USING ERRCODE = 'LT001';
  END IF;
  IF p_type <> 'FOLDER' THEN
    RAISE EXCEPTION 'tree: parent is not a folder' USING ERRCODE = 'LT001';
  END IF;
  IF p_ws <> NEW.workspace_id OR p_section <> NEW.section THEN
    RAISE EXCEPTION 'tree: parent is in another workspace or section' USING ERRCODE = 'LT001';
  END IF;
  IF NEW.deleted_at IS NULL AND p_deleted IS NOT NULL THEN
    RAISE EXCEPTION 'tree: parent is in the trash' USING ERRCODE = 'LT001';
  END IF;
  IF TG_OP = 'UPDATE' AND p_path <@ OLD.path THEN
    RAISE EXCEPTION 'tree: move would create a cycle' USING ERRCODE = 'LT001';
  END IF;
  NEW.path := p_path || label;
  RETURN NEW;
END
$$;
