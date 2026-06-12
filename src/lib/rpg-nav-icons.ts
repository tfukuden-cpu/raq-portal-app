/**
 * RPG風メニューアイコン（AI生成ドット絵）
 * 画像: public/rpg/nav-*.png（白背景シートを scripts/resplit-rpg-sheet.ps1 で分割→リネーム）
 * 対応する IconKey が無いものは AppNav 側で従来のSVGにフォールバックする
 */
import type { IconKey } from "@/components/icons";

export const RPG_NAV_ICONS: Partial<Record<IconKey, string>> = {
  Home:             "/rpg/nav-home.png",
  Calendar:         "/rpg/nav-calendar.png",
  BarChart2:        "/rpg/nav-chart.png",
  PenSquare:        "/rpg/nav-pen.png",
  Bell:             "/rpg/nav-bell.png",
  MessageSquare:    "/rpg/nav-chat.png",
  HelpCircle:       "/rpg/nav-help.png",
  UserCircle:       "/rpg/nav-user.png",
  Users:            "/rpg/nav-users.png",
  CalendarSettings: "/rpg/nav-calendar-gear.png",
  IdCard:           "/rpg/nav-idcard.png",
  Megaphone:        "/rpg/nav-megaphone.png",
  ClipboardCheck:   "/rpg/nav-clipboard.png",
  Smartphone:       "/rpg/nav-smartphone.png",
  Settings:         "/rpg/nav-gear.png",
  Grid:             "/rpg/nav-grid.png",
  Shield:           "/rpg/nav-shield.png",
};
