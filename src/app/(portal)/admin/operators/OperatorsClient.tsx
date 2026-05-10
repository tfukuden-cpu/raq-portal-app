"use client";

import { useState, useTransition } from "react";
import {
  createOperatorAction,
  updateOperatorNameAction,
  toggleOperatorActiveAction,
  resetOperatorPasswordAction,
} from "./actions";

type Operator = {
  id: string;
  name: string;
  display_name: string | null;
  is_active: boolean;
  must_change_password: boolean;
};

export default function OperatorsClient({
  operators,
  currentStaffId,
}: {
  operators: Operator[];
  currentStaffId: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  function notify(msg: string) {
    setMessage(msg);
    setTimeout(() => setMessage(null), 3000);
  }

  function handleCreate() {
    if (!newName.trim()) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("name", newName);
      const res = await createOperatorAction(fd);
      if (res.success) {
        setNewName("");
        setShowAdd(false);
        notify(res.message ?? "作成しました");
      } else {
        notify(res.message ?? "エラーが発生しました");
      }
    });
  }

  function handleUpdateName(id: string) {
    if (!editName.trim()) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", id);
      fd.set("name", editName);
      const res = await updateOperatorNameAction(fd);
      if (res.success) {
        setEditId(null);
        notify("更新しました");
      } else {
        notify(res.message ?? "エラーが発生しました");
      }
    });
  }

  function handleToggleActive(id: string, current: boolean) {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", id);
      fd.set("is_active", String(!current));
      const res = await toggleOperatorActiveAction(fd);
      if (!res.success) notify(res.message ?? "エラーが発生しました");
    });
  }

  function handleResetPassword(id: string) {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", id);
      const res = await resetOperatorPasswordAction(fd);
      notify(res.message ?? (res.success ? "リセットしました" : "エラー"));
    });
  }

  return (
    <div className="space-y-4">
      {/* トースト */}
      {message && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm shadow-lg">
          {message}
        </div>
      )}

      {/* 追加フォーム */}
      {showAdd ? (
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
          <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">新規運用者を追加</p>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="氏名"
            className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-zinc-400">社員IDは自動生成されます。初期パスワード: raq-init-2026</p>
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={isPending || !newName.trim()}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              作成
            </button>
            <button
              onClick={() => { setShowAdd(false); setNewName(""); }}
              className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
            >
              キャンセル
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowAdd(true)}
          className="w-full py-3 rounded-2xl border-2 border-dashed border-zinc-300 dark:border-zinc-700 text-sm text-zinc-500 dark:text-zinc-400 hover:border-blue-400 hover:text-blue-600 dark:hover:border-blue-500 dark:hover:text-blue-400 transition-colors"
        >
          ＋ 運用者を追加
        </button>
      )}

      {/* 運用者一覧 */}
      <ul className="space-y-2">
        {operators.map((op) => (
          <li
            key={op.id}
            className={`rounded-2xl border bg-white dark:bg-zinc-900 p-4 ${
              op.is_active
                ? "border-zinc-200 dark:border-zinc-800"
                : "border-zinc-100 dark:border-zinc-800/50 opacity-60"
            }`}
          >
            <div className="flex items-start gap-3">
              {/* アバタープレースホルダー（将来アバター作成機能で置き換え） */}
              <div className="w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0 text-lg font-bold text-blue-600 dark:text-blue-300">
                {(op.display_name ?? op.name).charAt(0)}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs text-zinc-400">{op.id}</span>
                  {!op.is_active && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500">
                      無効
                    </span>
                  )}
                  {op.must_change_password && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
                      初回PW未変更
                    </span>
                  )}
                  {op.id === currentStaffId && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                      自分
                    </span>
                  )}
                </div>

                {editId === op.id ? (
                  <div className="flex gap-2 mt-2">
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="flex-1 px-2 py-1 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      onClick={() => handleUpdateName(op.id)}
                      disabled={isPending}
                      className="px-3 py-1 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
                    >
                      保存
                    </button>
                    <button
                      onClick={() => setEditId(null)}
                      className="px-3 py-1 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs text-zinc-600 dark:text-zinc-400"
                    >
                      戻る
                    </button>
                  </div>
                ) : (
                  <p className="text-base font-semibold text-zinc-900 dark:text-zinc-50 mt-0.5">
                    {op.display_name ?? op.name}
                  </p>
                )}
              </div>

              {/* アクションメニュー */}
              {editId !== op.id && (
                <div className="flex gap-1.5 flex-shrink-0 ml-auto">
                  <button
                    onClick={() => { setEditId(op.id); setEditName(op.display_name ?? op.name); }}
                    disabled={isPending}
                    className="px-2.5 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  >
                    編集
                  </button>
                  <button
                    onClick={() => handleResetPassword(op.id)}
                    disabled={isPending}
                    className="px-2.5 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  >
                    PW初期化
                  </button>
                  {op.id !== currentStaffId && (
                    <button
                      onClick={() => handleToggleActive(op.id, op.is_active)}
                      disabled={isPending}
                      className={`px-2.5 py-1 rounded-lg border text-xs font-medium ${
                        op.is_active
                          ? "border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                          : "border-emerald-200 dark:border-emerald-800 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
                      }`}
                    >
                      {op.is_active ? "無効化" : "有効化"}
                    </button>
                  )}
                </div>
              )}
            </div>
          </li>
        ))}
        {operators.length === 0 && (
          <p className="text-sm text-zinc-400 text-center py-8">運用者アカウントがありません</p>
        )}
      </ul>
    </div>
  );
}
