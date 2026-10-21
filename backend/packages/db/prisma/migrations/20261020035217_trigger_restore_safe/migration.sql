-- pg_dump/pg_restore chạy với search_path rỗng: "OLD.path IS DISTINCT FROM NEW.path" trên kiểu ltree
-- không tìm thấy toán tử = (nằm ở schema public) nên không tạo lại được trigger khi khôi phục backup.
-- Viết lại điều kiện bằng toán tử có schema; nghĩa giữ nguyên (khác nhau, kể cả trường hợp NULL).
DROP TRIGGER IF EXISTS nodes_path_cascade ON nodes;
CREATE TRIGGER nodes_path_cascade
  AFTER UPDATE ON nodes
  FOR EACH ROW
  WHEN ((OLD.path IS NULL) <> (NEW.path IS NULL) OR NOT (OLD.path OPERATOR(public.=) NEW.path))
  EXECUTE FUNCTION nodes_move_subtree();
