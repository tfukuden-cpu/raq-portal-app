"use client";

/**
 * 日付別の休憩スロット（①〜③）編集モーダル
 * 保存するとその日だけのオーバーライドとして保存され、休憩割り当ても自動で再実行される。
 * 「共通設定に戻す」でオーバーライドを削除（案件共通の設定に戻る）。
 */

import { useState, useEffect, useTransition } from "react";
import {
  getBreakSlotSettingsForDateAction,
  saveBreakSlotDailySettingsAction,
  clearBreakSlotDailySettingsAction,
  type BreakSlotSetting,
} from "./break-actions";

const SHIFT_LABEL: Record<BreakSlotSetting["target_shift"], string> = {
  early: "早番向け", both: "早番・遅番", late: "遅番向け",
};

export default function BreakSlotDayEditor({
  projectId,
  date,
  onClose,
  onSaved,
}: {
  projectId: string;
  date: string; // YYYY-MM-DD
  onClose: () => void;
  onSaved?: (message: string) => void;
}) {
  const [slots, setSlots] = useState<BreakSlotSetting[] | null>(null);
  const [isDaily, setIsDaily] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    startTransition(async () => {
      const res = await getBreakSlotSettingsForDateAction(projectId, date);
      setSlots(res.slots.map(s => ({
        ...s,
        start_time: s.start_time.slice(0, 5),
        end_time:   s.end_time.slice(0, 5),
      })));
      setIsDaily(res.isDaily);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, date]);

  function update<K extends keyof BreakSlotSetting>(idx: number, field: K, value: BreakSlotSetting[K]) {
    setSlots(prev => prev?.map((s, i) => i === idx ? { ...s, [field]: value } : s) ?? null);
  }

  function handleSave() {
    if (!slots || isPending) return;
    setMsg(null);
    startTransition(async () => {
      const res = await saveBreakSlotDailySettingsAction(
        projectId, date,
        slots.map((s, i) => ({
          slot_number:  s.slot_number,
          label:        s.label,
          start_time:   s.start_time,
          end_time:     s.end_time,
          target_shift: s.target_shift,
          ratio:        s.ratio,
          sort_order:   i,
        })),
      );
      if (res.success) {
        onSaved?.(`この日の休憩設定を保存し、${res.count ?? 0}名に再割り振りしました`);
        onClose();
      } else {
        setMsg(res.error ?? "保存に失敗しました");
      }
    });
  }

  function handleClear() {
    if (isPending) return;
    if (!window.confirm("この日だけの設定を削除して、案件共通の休憩設定に戻しますか？（割り当ても再実行されます）")) return;
    setMsg(null);
    startTransition(async () => {
      const res = await clearBreakSlotDailySettingsAction(projectId, date);
      if (res.success) {
        onSaved?.(`共通設定に戻し、${res.count ?? 0}名に再割り振りしました`);
        onClose();
      } else {
        setMsg(res.error ?? "削除に失敗しました");
      }
    });
  }

  const totalRatio = (slots ?? []).reduce((a, s) => a + (Number(s.ratio) || 0), 0);
  const [, m, d] = date.split("-");
  const dateLabel = `${parseInt(m)}/${parseInt(d)}`;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-zinc-900 rounded-2xl w-full max-w-lg flex flex-col shadow-xl max-h-[90dvh]"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
          <div>
            <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-50">休憩スロット設定（{dateLabel}）</h2>
            <p className="text-[11px] text-zinc-400 mt-0.5">
              {isDaily ? "この日だけの設定が有効です" : "現在は案件共通の設定を表示中。保存するとこの日だけ上書きされます"}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500">✕</button>
        </div>

        <div className="px-5 py-4 overflow-y-auto space-y-3">
          {!slots ? (
            <p className="text-sm text-zinc-400 py-6 text-center">読み込み中…</p>
          ) : (
            <>
              {slots.map((s, i) => (
                <div key={s.slot_number} className="rounded-xl border border-zinc-200 dark:border-zinc-700 p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-zinc-700 dark:text-zinc-200 w-8">{s.label}</span>
                    <input type="time" value={s.start_time}
                      onChange={e => update(i, "start_time", e.target.value)}
                      className="px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm tabular-nums" />
                    <span className="text-zinc-400 text-sm">〜</span>
                    <input type="time" value={s.end_time}
                      onChange={e => update(i, "end_time", e.target.value)}
                      className="px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm tabular-nums" />
                  </div>
                  <div className="flex items-center gap-2">
                    <select value={s.target_shift}
                      onChange={e => update(i, "target_shift", e.target.value as BreakSlotSetting["target_shift"])}
                      className="flex-1 px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm">
                      {(Object.keys(SHIFT_LABEL) as BreakSlotSetting["target_shift"][]).map(k => (
                        <option key={k} value={k}>{SHIFT_LABEL[k]}</option>
                      ))}
                    </select>
                    <div className="flex items-center gap-1">
                      <input type="number" min={0} max={100} value={s.ratio}
                        onChange={e => update(i, "ratio", Number(e.target.value))}
                        className="w-16 px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm tabular-nums text-right" />
                      <span className="text-xs text-zinc-400">%</span>
                    </div>
                  </div>
                </div>
              ))}
              <p className={`text-xs text-right ${totalRatio === 100 ? "text-zinc-400" : "text-amber-500 font-semibold"}`}>
                比率合計: {totalRatio}%{totalRatio !== 100 && "（100%推奨）"}
              </p>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                保存すると、この日の休憩割り当てが新しい設定で自動的に作り直されます（個別に変更していたスロットも再割り振りされます）。
              </p>
              {msg && <p className="text-xs font-medium px-3 py-2 rounded-xl bg-red-50 dark:bg-red-950/20 text-red-500">✗ {msg}</p>}
            </>
          )}
        </div>

        <div className="px-5 pb-4 pt-2 border-t border-zinc-100 dark:border-zinc-800 shrink-0 flex items-center gap-2">
          {isDaily && (
            <button type="button" onClick={handleClear} disabled={isPending}
              className="px-3 py-2 rounded-xl text-xs font-semibold text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 transition-colors">
              共通設定に戻す
            </button>
          )}
          <div className="flex-1" />
          <button type="button" onClick={onClose}
            className="px-3.5 py-2 rounded-xl text-sm font-semibold text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
            キャンセル
          </button>
          <button type="button" onClick={handleSave} disabled={isPending || !slots}
            className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-bold transition-colors">
            {isPending ? "保存中…" : "この日の設定として保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
