"use client";

import { DotGothic16 } from "next/font/google";
import type { ReactNode } from "react";

/**
 * 王道RPG風UIの共有部品。
 * ホーム（dashboard/HomeClient.tsx）・打刻端末（TerminalPunchClient.tsx）と
 * 同じ世界観（紺#000846 + 白二重枠 + DotGothic16 + 夜空グラデ）をページ間で共有する。
 *
 * 注意: next/font はモジュールスコープで呼ぶ必要があるため、フォントインスタンスを
 * ここからエクスポートして各ページで `dotGothic.className` を使う。
 */
export const dotGothic = DotGothic16({ weight: "400", subsets: ["latin"], preload: false });

/** 夜空グラデーション（ページ背景） */
export const RPG_PAGE_BG = "linear-gradient(180deg, #02040f 0%, #050a24 45%, #0a1340 100%)";

/** 共通アニメーション。<style>{RPG_KEYFRAMES}</style> で1度だけ差し込む */
export const RPG_KEYFRAMES = `
@keyframes rpgTwinkle { 0%,100% { opacity: .2; } 50% { opacity: 1; } }
@keyframes rpgBob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
@keyframes rpgCursor { 0%,100% { opacity: 1; } 50% { opacity: 0; } }
`;

/** 装飾用の星座標（左%・上%・遅延s・サイズpx） */
export const RPG_STARS: { l: number; t: number; d: number; s: number }[] = [
  { l: 5, t: 14, d: 0, s: 2 }, { l: 12, t: 42, d: 1.3, s: 3 }, { l: 19, t: 22, d: 0.6, s: 2 },
  { l: 27, t: 55, d: 2.0, s: 2 }, { l: 34, t: 18, d: 0.9, s: 3 }, { l: 42, t: 38, d: 1.6, s: 2 },
  { l: 58, t: 35, d: 0.4, s: 2 }, { l: 66, t: 16, d: 1.9, s: 3 }, { l: 73, t: 48, d: 1.1, s: 2 },
  { l: 81, t: 24, d: 0.2, s: 2 }, { l: 88, t: 52, d: 1.5, s: 3 }, { l: 95, t: 18, d: 0.8, s: 2 },
];

/** 夜空グラデ＋またたく星のレイヤー（position: relative な親の中に置く） */
export function RpgStarfield() {
  return (
    <>
      {RPG_STARS.map((s, i) => (
        <span
          key={i}
          className="absolute rounded-full bg-white pointer-events-none"
          style={{
            left: `${s.l}%`, top: `${s.t}%`, width: s.s, height: s.s,
            animation: `rpgTwinkle ${2 + (i % 3)}s ease-in-out ${s.d}s infinite`,
          }}
        />
      ))}
    </>
  );
}

/** ドラクエ風ウィンドウ（紺背景＋白二重枠）。title を渡すと枠上にラベルを重ねる */
export function RpgWindow({
  title,
  children,
  className = "",
  bodyClassName = "",
}: {
  title?: string;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <div className="rounded-lg border-2 border-white bg-[#000846] p-[3px] h-full">
        <div className={`rounded-md border border-white/80 bg-[#000846] w-full h-full ${bodyClassName}`}>
          {children}
        </div>
      </div>
      {title && (
        <p className="absolute -top-[11px] left-4 bg-[#000846] border border-white rounded px-2.5 py-0.5 text-[12px] leading-none text-white select-none">
          {title}
        </p>
      )}
    </div>
  );
}

/** メッセージ末尾の点滅▼カーソル */
export function BlinkCursor() {
  return (
    <span className="inline-block text-white ml-1" style={{ animation: "rpgCursor 1s steps(1) infinite" }}>
      ▼
    </span>
  );
}
