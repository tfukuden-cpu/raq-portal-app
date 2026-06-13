"use client";

/**
 * ログインボーナスのガチャ演出モーダル（RPG風・宝箱）。
 * ホームでその日初回に自動表示される。claimLoginBonusAction を自分で呼び、
 * 宝箱を揺らす→開く→獲得コインを表示する。アニメ用 keyframes は
 * HomeClient の RPG_HOME_KEYFRAMES（グローバル）に定義済み。
 */
import { useState } from "react";
import { claimLoginBonusAction } from "./actions";
import { BONUS_TIERS, type BonusTier } from "@/lib/login-bonus";

type Phase = "ready" | "opening" | "done";

function ChestSvg({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 64 56" width="120" height="105" style={{ imageRendering: "pixelated" }} shapeRendering="crispEdges">
      {/* フタ */}
      {open ? (
        <g>
          <rect x="10" y="2"  width="44" height="6"  fill="#7a4a1e" />
          <rect x="8"  y="8"  width="48" height="10" fill="#9a6328" />
          <rect x="8"  y="8"  width="48" height="3"  fill="#c89a4e" />
        </g>
      ) : (
        <g>
          <rect x="8"  y="14" width="48" height="14" fill="#9a6328" />
          <rect x="8"  y="14" width="48" height="4"  fill="#c89a4e" />
          <rect x="6"  y="26" width="52" height="4"  fill="#5a3614" />
          <rect x="29" y="20" width="6"  height="8"  fill="#f5d061" />
          <rect x="30" y="22" width="4"  height="4"  fill="#7a4a1e" />
        </g>
      )}
      {/* 箱本体 */}
      <rect x="8"  y="30" width="48" height="22" fill="#7a4a1e" />
      <rect x="8"  y="30" width="48" height="4"  fill="#9a6328" />
      <rect x="8"  y="48" width="48" height="4"  fill="#5a3614" />
      {/* 金具 */}
      <rect x="14" y="30" width="4" height="22" fill="#c89a4e" />
      <rect x="46" y="30" width="4" height="22" fill="#c89a4e" />
      {!open && <rect x="29" y="36" width="6" height="8" fill="#f5d061" />}
      {/* 中の光（開いたとき） */}
      {open && <rect x="14" y="30" width="36" height="6" fill="#fff7d6" opacity="0.9" />}
    </svg>
  );
}

function CoinIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} className="inline-block align-middle">
      <circle cx="8" cy="8" r="7" fill="#f5c542" stroke="#a8740a" strokeWidth="1.5" />
      <circle cx="8" cy="8" r="4.5" fill="none" stroke="#d99b1c" strokeWidth="1" />
      <text x="8" y="11" textAnchor="middle" fontSize="7" fontWeight="bold" fill="#7a5200">G</text>
    </svg>
  );
}

export default function LoginBonusModal({
  onClose,
  onClaimed,
  dotClass = "",
}: {
  onClose: () => void;
  onClaimed: (totalCoins: number) => void;
  dotClass?: string;
}) {
  const [phase, setPhase] = useState<Phase>("ready");
  const [result, setResult] = useState<{ tier: BonusTier; gain: number; totalCoins: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = async () => {
    if (phase !== "ready") return;
    setPhase("opening");
    setError(null);
    const r = await claimLoginBonusAction();
    // 宝箱を少し揺らす演出時間
    await new Promise(res => setTimeout(res, 950));

    if (!r.ok) {
      setError(r.message);
      setPhase("ready");
      return;
    }
    if (r.alreadyClaimed) {
      // すでに受取済み（別端末など）→ 静かに閉じる
      onClaimed(r.totalCoins);
      onClose();
      return;
    }
    setResult({ tier: r.tier, gain: r.gain, totalCoins: r.totalCoins });
    setPhase("done");
    onClaimed(r.totalCoins);
  };

  const tierInfo = result ? BONUS_TIERS[result.tier] : null;

  return (
    <div className={`fixed inset-0 z-[400] bg-black/80 flex items-center justify-center px-6 ${dotClass}`}>
      <div className="w-full max-w-sm">
        <div className="rounded-lg border-2 border-white bg-[#000846] p-[3px] shadow-2xl shadow-black/60">
          <div className="rounded-md border border-white/80 bg-[#000846]">
            {/* タイトル */}
            <div className="border-b border-white/20 px-4 py-2.5 text-center">
              <p className="text-amber-300 text-[14px]">ログインボーナス</p>
            </div>

            <div className="px-5 py-6 flex flex-col items-center">
              {/* 宝箱 */}
              <div className="relative h-32 flex items-center justify-center">
                {/* 光のバースト（開いたとき） */}
                {phase === "done" && (
                  <div
                    className="absolute w-40 h-40 rounded-full pointer-events-none"
                    style={{
                      background: `radial-gradient(circle, ${tierInfo?.color}66 0%, transparent 70%)`,
                      animation: "bonusBurst .5s ease-out forwards",
                    }}
                  />
                )}
                <div
                  style={{
                    animation:
                      phase === "opening" ? "bonusShake .5s ease-in-out infinite"
                      : phase === "done"  ? "bonusPop .5s ease-out"
                      : "rpgBob 1.6s steps(2) infinite",
                  }}
                >
                  <ChestSvg open={phase === "done"} />
                </div>
              </div>

              {/* メッセージ */}
              {phase === "done" && result && tierInfo ? (
                <div className="text-center mt-2" style={{ animation: "bonusPop .45s ease-out" }}>
                  <p className="text-[15px]" style={{ color: tierInfo.color }}>{tierInfo.label}</p>
                  <p className="mt-2 text-white text-[28px] font-bold tabular-nums leading-none">
                    <CoinIcon size={22} /> +{result.gain}
                  </p>
                  <p className="mt-3 text-white/60 text-[12px]">
                    しょじコイン　<CoinIcon size={13} /> <span className="text-white tabular-nums">{result.totalCoins}</span>
                  </p>
                </div>
              ) : (
                <p className="text-white text-[13px] text-center mt-2 leading-relaxed">
                  ＊「きょうの ボーナスだ。<br />　 たからばこを あけてみよう！」
                </p>
              )}

              {error && <p className="text-red-400 text-[12px] mt-3">{error}</p>}

              {/* ボタン */}
              {phase === "done" ? (
                <button
                  onClick={onClose}
                  className="mt-5 w-full h-11 rounded-lg border-2 border-white text-white text-[14px] hover:bg-white/10 active:scale-[0.98] transition"
                >
                  ▶ とじる
                </button>
              ) : (
                <button
                  onClick={open}
                  disabled={phase === "opening"}
                  className="mt-5 w-full h-11 rounded-lg border-2 border-amber-300 text-amber-300 text-[14px] hover:bg-amber-300/10 active:scale-[0.98] transition disabled:opacity-60"
                >
                  {phase === "opening" ? "あけている……" : "▶ たからばこを あける"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
