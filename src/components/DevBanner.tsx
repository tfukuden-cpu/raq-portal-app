"use client";

import { useTransition } from "react";
import { setViewModeAction } from "@/app/(portal)/dev/actions";

type ViewMode = "staff" | "admin" | "ops";

type Props = {
  viewMode: ViewMode;
  availableModes: ViewMode[];
};

const MODE_LABEL: Record<ViewMode, string> = {
  staff: "スタッフ",
  admin: "管理者",
  ops:   "運用",
};

const MODE_DOT: Record<ViewMode, string> = {
  staff: "bg-sky-400",
  admin: "bg-emerald-400",
  ops:   "bg-violet-400",
};

export default function DevBanner({ viewMode, availableModes }: Props) {
  const [isPending, startTransition] = useTransition();

  return (
    <div className="sticky top-0 z-30 h-8 flex items-center px-4 gap-3 bg-[#111111] border-b border-white/[0.06]">
      {/* 現在のモード表示 */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <span className={`w-1.5 h-1.5 rounded-full ${MODE_DOT[viewMode]}`} />
        <span className="text-[10px] font-medium text-zinc-500 tracking-wider uppercase select-none">
          {MODE_LABEL[viewMode]}
        </span>
      </div>

      {/* 区切り */}
      <div className="w-px h-3 bg-white/[0.08] flex-shrink-0" />

      {/* モード切替ボタン */}
      <div className="flex items-center gap-1">
        {availableModes.map((mode) => {
          const isActive = viewMode === mode;
          return (
            <button
              key={mode}
              type="button"
              disabled={isPending || isActive}
              onClick={() => startTransition(() => setViewModeAction(mode))}
              className={`text-[10px] font-semibold px-2.5 py-0.5 rounded-md transition-colors disabled:cursor-default ${
                isActive
                  ? "text-zinc-200 bg-white/[0.08]"
                  : "text-zinc-600 hover:text-zinc-300 hover:bg-white/[0.05]"
              }`}
            >
              {isPending && isActive ? "…" : MODE_LABEL[mode]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
