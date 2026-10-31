"use client";

import { Ellipsis, type LucideIcon } from "lucide-react";
import { Fragment } from "react";
import { cn } from "@/lib/cn";
import { ICON_BUTTON_SIZES, IconButton, type IconButtonSize } from "./button";
import { MenuItem, MenuSeparator, PopoverPanel, usePopover } from "./popover";

export interface MenuAction {
  icon: LucideIcon;
  label: string;
  onSelect: () => void;
  danger?: boolean;
  hidden?: boolean;
}

export function RowMenu({
  groups,
  label = "Thao tác",
  icon = Ellipsis,
  size = "md",
  className,
  panelClassName = "min-w-56",
}: {
  groups: MenuAction[][];
  label?: string;
  icon?: LucideIcon;
  size?: IconButtonSize;
  className?: string;
  panelClassName?: string;
}) {
  const { open, setOpen, toggle, rootRef } = usePopover();
  const visible = groups.map((g) => g.filter((a) => !a.hidden)).filter((g) => g.length);
  if (!visible.length) return <span className={cn("shrink-0", ICON_BUTTON_SIZES[size], className)} aria-hidden />;
  return (
    <div ref={rootRef} className="relative">
      <IconButton icon={icon} label={label} aria-expanded={open} aria-haspopup="menu" onClick={toggle} size={size} className={className} />
      <PopoverPanel open={open} align="right" className={panelClassName}>
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
