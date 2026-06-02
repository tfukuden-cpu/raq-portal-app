# アイコン一覧

> ファイル: `src/components/icons.tsx`

## 使い方

```typescript
import { ICON_MAP, type IconKey } from "@/components/icons";

// ナビゲーション定義で使う場合
{ href: "/xxx", icon: "Home" as IconKey, label: "ホーム" }

// コンポーネントで直接使う場合
const Icon = ICON_MAP["Home"];
return <Icon className="w-5 h-5" />;
```

## 利用可能な IconKey 一覧

```
Home, Clock, Calendar, Bell, Vacation, EditRequest,
Users, CalendarSettings, CalendarCheck, ClipboardCheck,
CheckSquare, Square, Megaphone, Grid, SettingsIcon,
PlusIcon, XIcon, LogOutIcon, MenuIcon,
ChevronRightIcon, ChevronLeftIcon, CloseIcon,
LoginIcon, CoffeeIcon, CheckCircleIcon, UserCircle,
DownloadIcon, BarChart2Icon, PenSquareIcon, SendIcon,
ShieldIcon, IdCardIcon, MessageSquareIcon, BriefcaseIcon,
HelpCircleIcon, SmartphoneIcon, TrophyIcon, LayoutGridIcon
```

## 新しいアイコンを追加するとき

1. `src/components/icons.tsx` にSVGコンポーネントを追加
2. `ICON_MAP` にキー追加
3. `IconKey` 型は `keyof typeof ICON_MAP` で自動更新される

**絵文字は使わない。SVGアイコンで統一。**
