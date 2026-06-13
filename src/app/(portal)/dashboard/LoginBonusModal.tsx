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

/** AI生成ドット絵の宝箱（閉/開）。public/rpg/bonus-chest-closed/open.png */
function Chest({ open }: { open: boolean }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={open ? "/rpg/bonus-chest-open.png" : "/rpg/bonus-chest-closed.png"}
      alt=""
      draggable={false}
      className="h-28 w-auto select-none"
      style={{ imageRendering: "pixelated" }}
    />
  );
}

/** AI生成ドット絵の金貨。public/rpg/bonus-coin.png */
function CoinIcon({ size = 16 }: { size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/rpg/bonus-coin.png"
      alt="コイン"
      draggable={false}
      width={size}
      height={size}
      className="inline-block align-middle select-none"
      style={{ imageRendering: "pixelated" }}
    />
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
                  <Chest open={phase === "done"} />
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
