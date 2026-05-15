"use client";
import { useState } from "react";

const LINE_ICON = (
  <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M12 2C6.48 2 2 5.9 2 10.67c0 2.95 1.54 5.57 3.95 7.3L5 21l3.15-1.56C9.31 19.77 10.63 20 12 20c5.52 0 10-3.9 10-8.67S17.52 2 12 2z" />
  </svg>
);

export default function LineButton({
  action,
  label = "LINE送信",
}: {
  action: () => Promise<{ ok: boolean; error?: string }>;
  label?: string;
}) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errMsg, setErrMsg] = useState("");

  async function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    setState("sending");
    const res = await action();
    if (res.ok) {
      setState("sent");
    } else {
      setState("error");
      setErrMsg(res.error ?? "エラー");
      setTimeout(() => setState("idle"), 3000);
    }
  }

  if (state === "sent")
    return <span className="text-xs font-semibold text-green-600 dark:text-green-400">✓ 送信済</span>;
  if (state === "error")
    return <span className="text-xs text-red-500">{errMsg}</span>;

  return (
    <button
      onClick={handleClick}
      disabled={state === "sending"}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800 transition-colors disabled:opacity-50 whitespace-nowrap"
    >
      {LINE_ICON}
      {state === "sending" ? "送信中…" : label}
    </button>
  );
}
