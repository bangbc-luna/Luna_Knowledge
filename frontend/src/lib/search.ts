import { api } from "./api";
import type { ApiOk } from "./api-types";
import type { NodeSection, NodeType } from "./types";

export type SearchResult = ApiOk<"/api/v1/search", "get">;
export type SearchHit = SearchResult["items"][number];
export type SearchPart = SearchHit["name"][number];

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
