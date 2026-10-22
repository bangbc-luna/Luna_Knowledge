import { api } from "./api";
import type { NodeItem, NodeSection, NodeType } from "./types";

export interface SearchPart {
  text: string;
  match: boolean;
}

export interface SearchHit {
  node: NodeItem;
  workspace: { id: string; name: string };
  path: string[];
  name: SearchPart[];
  snippet: SearchPart[] | null;
  matchedIn: "name" | "content" | "tags";
}

export interface SearchResult {
  items: SearchHit[];
  total: number;
  nextCursor: string | null;
}

export interface SearchFilters {
  q: string;
  workspaceId?: string;
  section?: NodeSection;
  type?: NodeType;
  tagIds?: string[];
  createdBy?: string;
  from?: string;
  cursor?: string;
  limit?: number;
}

export function searchNodes(f: SearchFilters) {
  return api<SearchResult>("/search", {
    query: {
      q: f.q,
      workspaceId: f.workspaceId,
      section: f.section,
      type: f.type,
      tagIds: f.tagIds?.length ? f.tagIds.join(",") : undefined,
      createdBy: f.createdBy,
      from: f.from,
      cursor: f.cursor,
      limit: f.limit,
    },
  });
}
