// 仮組（自動シフト生成）の設定。"use server" ではない plain モジュール。

/**
 * 仮組アルゴリズムから除外するセクション（手動編集運用・ユーザー指定）。
 * これらのセクションは自動割当・余剰配置の対象にせず、シフト管理で手動入力する。
 * - 「インフォ」＝パターン「販売/インフォ」のセクション。「H MOTA」＝ヘルプモーター。
 * - 「販売」セクション（販売早番・販売遅番）は仮組に含める（除外しない）。
 * - 既存の手動エントリは保持される（validShiftNames に含まれるため stale 化しない）。
 * - 再仮組みモーダルのセクション選択肢からも除外する。
 */
export const MANUAL_DRAFT_SECTIONS = ["インフォ", "H MOTA"] as const;

/** 指定セクションが手動編集（仮組除外）セクションか */
export function isManualDraftSection(section: string | null | undefined): boolean {
  return !!section && (MANUAL_DRAFT_SECTIONS as readonly string[]).includes(section);
}
