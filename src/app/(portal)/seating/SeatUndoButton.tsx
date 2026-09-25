"use client";

/**
 * 「席替えを元に戻す」ボタン（当日座席表・翌日座席プラン共用）
 * - 直前の保存に1手だけ戻す（座席だけ・休憩スロットには触らない）
 * - 退避は1世代のみ。戻すと「戻す前の配置」が新しい退避になるのでトグルになる
 * - 退避が無い日は無効化する（snapshotAt が null）
 */

import { useTransition } from "react";
import { undoSeatAssignmentsAction } from "./actions";
import { UndoIcon } from "@/components/icons";
import { formatTimeJP } from "@/lib/datetime";

export default function SeatUndoButton({
  projectId,
  date,
  snapshotAt,
  onDone,
  lockedBy,
  className,
}: {
  projectId: string;
  /** 対象日（YYYY-MM-DD） */
  date: string;
  /** 退避が保存された時刻（ISO・null なら戻せる配置が無い） */
  snapshotAt: string | null;
  /** 成功/失敗メッセージを親のトーストに出す */
  onDone?: (message: string, ok: boolean) => void;
  /** 他の管理者が席替えを編集中＝押させない（編集中の保存で戻した内容が消えるため） */
  lockedBy?: string[];
  className?: string;
}) {
  const [isPending, startTransition] = useTransition();

  const locked = (lockedBy?.length ?? 0) > 0;
  // 当日以外を見ているときは日付も出す（過去日・翌日プランを誤って上書きしないように）
  const todayJST = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  const datePrefix = snapshotAt && date !== todayJST
    ? `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))} `
    : "";
  const timeLabel = snapshotAt ? `${datePrefix}${formatTimeJP(snapshotAt)}` : null;
  const disabled = isPending || !snapshotAt || locked;

  function handleClick() {
    if (disabled) return;
    const ok = window.confirm(
      `いまの配置は上書きされます。${timeLabel}の配置に戻しますか？`,
    );
    if (!ok) return;

    startTransition(async () => {
      const res = await undoSeatAssignmentsAction(projectId, date);
      if (!res.success) {
        onDone?.(res.message ?? "元に戻すのに失敗しました", false);
        return;
      }
      let msg = `配置を戻しました（${res.restoredCount ?? 0}名）。もう一度押すと戻す前の配置に戻ります`;
      if (res.skipped && res.skipped > 0) {
        msg += `｜席が無くなった${res.skipped}件は戻せませんでした`;
      }
      onDone?.(msg, true);
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      title={
        locked
          ? `${lockedBy!.join("・")}が席替えを編集中のため操作できません`
          : snapshotAt
            ? `${timeLabel}に退避した配置に戻します（座席だけ・休憩は変わりません）`
            : "戻せる配置がありません（まだ席替えを保存していません）"
      }
      className={
        className ??
        [
          "flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors",
          disabled
            ? "text-zinc-400 dark:text-zinc-500 bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 cursor-not-allowed opacity-60"
            : "text-blue-600 dark:text-blue-400 bg-white dark:bg-zinc-900 border-blue-200 dark:border-blue-800 hover:bg-blue-50 dark:hover:bg-blue-950/40",
        ].join(" ")
      }
    >
      <UndoIcon className="w-3.5 h-3.5" />
      {isPending
        ? "戻しています…"
        : locked
          ? "🔒 席替えを元に戻す"
          : timeLabel
            ? `${timeLabel}の配置に戻す`
            : "席替えを元に戻す"}
    </button>
  );
}
