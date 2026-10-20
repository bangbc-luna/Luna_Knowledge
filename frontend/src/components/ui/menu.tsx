"use client";

import { Ellipsis, type LucideIcon } from "lucide-react";
import { Fragment } from "react";
import { IconButton } from "./button";
import { MenuItem, MenuSeparator, PopoverPanel, usePopover } from "./popover";

export interface MenuAction {
  icon: LucideIcon;
  label: string;
  onSelect: () => void;
  danger?: boolean;
  hidden?: boolean;
}

/** Menu ⋯ của một dòng. Nhóm cuối là nhóm nguy hiểm (xoá), tách bằng đường kẻ. */
export function RowMenu({ groups, label = "Thao tác" }: { groups: MenuAction[][]; label?: string }) {
  const { open, setOpen, toggle, rootRef } = usePopover();
  const visible = groups.map((g) => g.filter((a) => !a.hidden)).filter((g) => g.length);
  if (!visible.length) return <span className="size-8 shrink-0" />;
  return (
    <div ref={rootRef} className="relative">
      <IconButton icon={Ellipsis} label={label} aria-expanded={open} aria-haspopup="menu" onClick={toggle} />
      <PopoverPanel open={open} align="right" className="min-w-56">
        <div role="menu">
          {visible.map((group, gi) => (
            <Fragment key={gi}>
              {gi ? <MenuSeparator /> : null}
              <div className="px-1">
                {group.map((a) => (
                  <MenuItem
                    key={a.label}
                    role="menuitem"
                    danger={a.danger}
                    onClick={() => {
                      setOpen(false);
                      a.onSelect();
                    }}
                  >
                    <a.icon className={a.danger ? "size-4 shrink-0" : "size-4 shrink-0 text-muted"} aria-hidden />
                    {a.label}
                  </MenuItem>
                ))}
              </div>
            </Fragment>
          ))}
        </div>
      </PopoverPanel>
    </div>
  );
}
