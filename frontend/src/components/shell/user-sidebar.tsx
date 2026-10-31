"use client";

import { TreeColumn } from "./tree-column";
import { WorkspaceRail } from "./workspace-rail";

export function UserSidebar() {
  return (
    <div className="flex h-full">
      <WorkspaceRail />
      <TreeColumn />
    </div>
  );
}
