import React from "react";
import { Link } from "react-router-dom";
import { Feather, Sun, Moon, LogOut, Menu, CalendarDays } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { User } from "@/types";

interface Props {
  onLeftMenu?: () => void;
  onRightMenu?: () => void;
}

export default function TopBar({ onLeftMenu, onRightMenu }: Props) {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const u = user as User | false | null;

  const initials = ((u && u.name) || (u && u.email) || "?").slice(0, 2).toUpperCase();

  return (
    <header
      className="sticky top-0 z-40 h-14 border-b border-border bg-background/80 backdrop-blur-xl flex items-center justify-between px-4 lg:px-6"
      data-testid="topbar"
    >
      <div className="flex items-center gap-2">
        <Button size="icon" variant="ghost" className="lg:hidden h-8 w-8" onClick={onLeftMenu} data-testid="topbar-left-menu-btn">
          <Menu className="w-4 h-4" strokeWidth={1.25} />
        </Button>
        <Link to="/" className="flex items-center gap-2">
          <Feather className="w-4 h-4" strokeWidth={1.25} />
          <span className="font-serif text-xl tracking-tight">Inkwell</span>
        </Link>
      </div>

      <div className="flex items-center gap-1">
        <Button size="icon" variant="ghost" className="lg:hidden h-8 w-8" onClick={onRightMenu} data-testid="topbar-right-menu-btn">
          <CalendarDays className="w-4 h-4" strokeWidth={1.25} />
        </Button>
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={toggle} data-testid="theme-toggle-btn">
          {theme === "dark" ? <Sun className="w-4 h-4" strokeWidth={1.25} /> : <Moon className="w-4 h-4" strokeWidth={1.25} />}
        </Button>

        {u && u.user_id && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="ml-1 outline-none" data-testid="user-menu-btn">
                <Avatar className="h-7 w-7">
                  {u.picture && <AvatarImage src={u.picture} alt={u.name || ""} />}
                  <AvatarFallback className="text-xs font-mono bg-secondary">{initials}</AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 bg-popover border-border">
              <DropdownMenuLabel className="font-mono text-xs">
                <div className="truncate">{u.name}</div>
                <div className="text-muted-foreground truncate">{u.email}</div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={logout} data-testid="logout-btn" className="cursor-pointer">
                <LogOut className="w-3.5 h-3.5 mr-2" strokeWidth={1.25} /> Çıkış yap
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </header>
  );
}
