type IconProps = { className?: string };

const base = {
  xmlns: "http://www.w3.org/2000/svg",
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function HomeIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4.5 10.5L12 4.5l7.5 6" />
      <path d="M6.5 9.5V19a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V9.5" />
      <path d="M10 20v-4.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V20" />
    </svg>
  );
}

export function ClockIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8.2v4.3l3 1.9" />
    </svg>
  );
}

export function CalendarIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="4" y="5.5" width="16" height="14.5" rx="2.5" />
      <path d="M8 4v3" />
      <path d="M16 4v3" />
      <path d="M4 9.5h16" />
      <path d="M8 13h.01" />
      <path d="M12 13h.01" />
      <path d="M16 13h.01" />
      <path d="M8 16.5h.01" />
      <path d="M12 16.5h.01" />
    </svg>
  );
}

export function BellIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M8 17.5h8" />
      <path d="M10 19a2 2 0 0 0 4 0" />
      <path d="M17 10.5a5 5 0 1 0-10 0c0 3-1.5 4.5-2 5h14c-.5-.5-2-2-2-5Z" />
    </svg>
  );
}

export function VacationIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4.5 12a7.5 7.5 0 0 1 15 0" />
      <path d="M4.5 12c1.2 0 1.8-.7 3-.7s1.8.7 3 .7 1.8-.7 3-.7 1.8.7 3 .7 1.8-.7 3-.7" />
      <path d="M12 12v5.5a2 2 0 0 0 4 0" />
    </svg>
  );
}

export function EditRequestIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M5 19l4-.9 8.8-8.8a2 2 0 0 0-2.8-2.8L6.2 15.3 5 19Z" />
      <path d="M14 7.5l2.8 2.8" />
      <path d="M5 19h14" />
    </svg>
  );
}

export function UsersIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="8.5" r="2.8" />
      <path d="M7.2 19a4.8 4.8 0 0 1 9.6 0" />
      <circle cx="5.8" cy="10.5" r="2" />
      <path d="M3 18a3.4 3.4 0 0 1 3.5-3.2" />
      <circle cx="18.2" cy="10.5" r="2" />
      <path d="M17.5 14.8A3.4 3.4 0 0 1 21 18" />
    </svg>
  );
}

export function CalendarSettingsIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 9.5V7.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4.5" />
      <path d="M8 4v3" />
      <path d="M16 4v3" />
      <path d="M4 9.5h16" />
      <path d="M4 9.5V18a2 2 0 0 0 2 2h6" />
      <circle cx="17" cy="17" r="2" />
      <path d="M17 13.8v1" />
      <path d="M17 19.2v1" />
      <path d="M13.8 17h1" />
      <path d="M19.2 17h1" />
      <path d="M14.8 14.8l.7.7" />
      <path d="M18.5 18.5l.7.7" />
      <path d="M19.2 14.8l-.7.7" />
      <path d="M15.5 18.5l-.7.7" />
    </svg>
  );
}

export function CalendarCheckIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="4" y="5.5" width="16" height="14.5" rx="2.5" />
      <path d="M8 4v3" />
      <path d="M16 4v3" />
      <path d="M4 9.5h16" />
      <path d="M8.5 15.3l2.2 2.2 4.8-4.8" />
    </svg>
  );
}

export function ClipboardCheckIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M9 5.5h6" />
      <path d="M10 3.5h4a1 1 0 0 1 1 1v2H9v-2a1 1 0 0 1 1-1Z" />
      <path d="M8 6.5H6.5A1.5 1.5 0 0 0 5 8v10.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V8a1.5 1.5 0 0 0-1.5-1.5H16" />
      <path d="M8.5 13.8l2.2 2.2 4.8-4.8" />
    </svg>
  );
}

export function MegaphoneIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M14 8.5l5-2v11l-5-2" />
      <path d="M5.8 10.5H14v4H5.8a2 2 0 0 1 0-4Z" />
      <path d="M7.8 14.5v3.5" />
      <path d="M10 18H6.8" />
    </svg>
  );
}

export function GridIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="4.5" y="4.5" width="5.5" height="5.5" rx="1.4" />
      <rect x="14" y="4.5" width="5.5" height="5.5" rx="1.4" />
      <rect x="4.5" y="14" width="5.5" height="5.5" rx="1.4" />
      <rect x="14" y="14" width="5.5" height="5.5" rx="1.4" />
    </svg>
  );
}

export function SettingsIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}

export function PlusIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function LogOutIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M10 5.5H6.5A1.5 1.5 0 0 0 5 7v10a1.5 1.5 0 0 0 1.5 1.5H10" />
      <path d="M14 8.5l3.5 3.5-3.5 3.5" />
      <path d="M9.5 12h8" />
    </svg>
  );
}

export function MenuIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M5 7.5h14" />
      <path d="M5 12h14" />
      <path d="M5 16.5h14" />
    </svg>
  );
}

export function ChevronRightIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M9.5 5.5l6.5 6.5-6.5 6.5" />
    </svg>
  );
}

export function ChevronLeftIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M14.5 5.5L8 12l6.5 6.5" />
    </svg>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M6.5 6.5l11 11" />
      <path d="M17.5 6.5l-11 11" />
    </svg>
  );
}

export function LoginIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M14 5.5H17.5A1.5 1.5 0 0 1 19 7v10a1.5 1.5 0 0 1-1.5 1.5H14" />
      <path d="M10 15.5l3.5-3.5L10 8.5" />
      <path d="M4.5 12h9" />
    </svg>
  );
}

export function CoffeeIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M5 7h11v7a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V7Z" />
      <path d="M16 9h1.5a2.5 2.5 0 0 1 0 5H16" />
      <path d="M8 4v3" />
      <path d="M12 4v3" />
    </svg>
  );
}

export function CheckCircleIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="8" />
      <path d="M8.5 12.5l2.5 2.5 4.5-5" />
    </svg>
  );
}

export function UserCircleIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="10" r="2.8" />
      <path d="M6.5 18.5a5.5 5.5 0 0 1 11 0" />
    </svg>
  );
}

export function BarChart2Icon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="4" y="14" width="3.5" height="6" rx="1" />
      <rect x="10.25" y="9" width="3.5" height="11" rx="1" />
      <rect x="16.5" y="4" width="3.5" height="16" rx="1" />
    </svg>
  );
}

export function PenSquareIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 4.5H6.5A2 2 0 0 0 4.5 6.5v11A2 2 0 0 0 6.5 19.5h11A2 2 0 0 0 19.5 17.5V12" />
      <path d="M15.5 5l3.5 3.5-7 7H8.5v-3.5l7-7Z" />
    </svg>
  );
}

export function SendIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M5 12L19 5l-7 14-2-7-5-2Z" />
    </svg>
  );
}

export function ShieldIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 2L3 7v5c0 5.25 3.75 10.15 9 11.25C17.25 22.15 21 17.25 21 12V7L12 2Z" />
    </svg>
  );
}

export function IdCardIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      <circle cx="9" cy="11" r="2" />
      <path d="M6 17a3 3 0 0 1 6 0" />
      <path d="M14 10h4" />
      <path d="M14 13.5h3" />
    </svg>
  );
}

export function MessageSquareIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function BriefcaseIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
      <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
    </svg>
  );
}

export const ICON_MAP = {
  Home: HomeIcon,
  Clock: ClockIcon,
  Calendar: CalendarIcon,
  Bell: BellIcon,
  Vacation: VacationIcon,
  EditRequest: EditRequestIcon,
  Users: UsersIcon,
  CalendarSettings: CalendarSettingsIcon,
  CalendarCheck: CalendarCheckIcon,
  ClipboardCheck: ClipboardCheckIcon,
  Megaphone: MegaphoneIcon,
  Grid: GridIcon,
  UserCircle: UserCircleIcon,
  BarChart2: BarChart2Icon,
  PenSquare: PenSquareIcon,
  Settings: SettingsIcon,
  Shield: ShieldIcon,
  IdCard: IdCardIcon,
  MessageSquare: MessageSquareIcon,
  Briefcase: BriefcaseIcon,
} as const;

export type IconKey = keyof typeof ICON_MAP;
