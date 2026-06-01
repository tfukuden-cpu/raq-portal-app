"use client";

/**
 * Tomodachi Collection-style avatar editor
 * Shows a live SVG preview + tabbed controls for each face part.
 */
import { useState, useTransition } from "react";
import AvatarSvg from "./AvatarSvg";
import {
  type AvatarConfig,
  DEFAULT_AVATAR,
  BG_OPTIONS,
  SKIN_COLORS,
  HAIR_COLOR_OPTIONS,
  HAIR_STYLE_LABELS,
  EYE_STYLE_LABELS,
  MOUTH_STYLE_LABELS,
} from "./avatar-types";
import { updateAvatarConfigAction } from "./actions";

// ── Section definitions ───────────────────────────────────────────────────────

type SectionId = "bg" | "skin" | "hair_style" | "hair_color" | "eyes" | "mouth" | "cheeks";

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: "bg",         label: "背景" },
  { id: "skin",       label: "肌"   },
  { id: "hair_style", label: "髪型" },
  { id: "hair_color", label: "髪色" },
  { id: "eyes",       label: "目"   },
  { id: "mouth",      label: "口"   },
  { id: "cheeks",     label: "ほっぺ" },
];

// ── Reusable sub-components ───────────────────────────────────────────────────

/** Pill-shaped selection button for text-labelled options */
function OptionPill({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`py-2 px-1 rounded-xl text-[10px] font-semibold transition-all ${
        selected
          ? "bg-blue-600 text-white scale-105 shadow"
          : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
      }`}
    >
      {label}
    </button>
  );
}

/** Circle swatch for color selection */
function ColorSwatch({
  hex,
  selected,
  onClick,
  title,
}: {
  hex: string;
  selected: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`w-10 h-10 rounded-full border-2 transition-all ${
        selected
          ? "ring-2 ring-offset-2 ring-blue-500 scale-110 border-white dark:border-zinc-900"
          : "border-zinc-200 dark:border-zinc-700 hover:scale-105"
      }`}
      style={{ backgroundColor: hex }}
    />
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AvatarEditor({
  initialConfig,
}: {
  initialConfig: AvatarConfig | null;
}) {
  const [config, setConfig]   = useState<AvatarConfig>(initialConfig ?? DEFAULT_AVATAR);
  const [section, setSection] = useState<SectionId>("bg");
  const [open, setOpen]       = useState(false);
  const [isPending, start]    = useTransition();

  /** Apply a partial change and auto-save */
  const update = (partial: Partial<AvatarConfig>) => {
    const next = { ...config, ...partial };
    setConfig(next);
    const fd = new FormData();
    fd.set("config", JSON.stringify(next));
    start(async () => {
      await updateAvatarConfigAction(fd);
    });
  };

  return (
    <div className="flex flex-col items-center gap-2">
      {/* ── Avatar preview button ── */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="relative group"
        aria-label="アバターを変更"
      >
        <div className="w-36 h-36 rounded-full overflow-hidden shadow-md border-2 border-white dark:border-zinc-700 transition-transform group-active:scale-95">
          <AvatarSvg config={config} size={144} />
        </div>
        {/* Edit overlay */}
        <div className="absolute inset-0 rounded-full bg-black/25 opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
          <svg className="w-6 h-6 text-white drop-shadow" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M15.232 5.232l3.536 3.536M9 13a4 4 0 108 0 4 4 0 00-8 0zm10.95-6.95a2.5 2.5 0 010 3.536l-9.9 9.9-4.243.707.707-4.243 9.9-9.9a2.5 2.5 0 013.536 0z" />
          </svg>
        </div>
      </button>
      <p className="text-[11px] text-zinc-400">タップして変更</p>

      {/* ── Editor panel ── */}
      {open && (
        <div className="w-full bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-2xl p-4 shadow-lg space-y-3">

          {/* Section tab strip */}
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
            {SECTIONS.map(s => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSection(s.id)}
                className={`flex-shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${
                  section === s.id
                    ? "bg-blue-600 text-white shadow-sm"
                    : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* Section content */}
          <div className="min-h-[72px] flex items-center justify-center">

            {/* 背景 */}
            {section === "bg" && (
              <div className="grid grid-cols-4 gap-2 w-full">
                {BG_OPTIONS.map(bg => (
                  <button
                    key={bg.key}
                    type="button"
                    onClick={() => update({ bg: bg.key })}
                    className={`h-10 rounded-xl ${bg.cls} text-[10px] font-bold text-white/80 transition-all ${
                      config.bg === bg.key
                        ? "ring-2 ring-offset-1 ring-blue-500 scale-105 shadow"
                        : "hover:scale-105 active:scale-95"
                    }`}
                  >
                    {bg.label}
                  </button>
                ))}
              </div>
            )}

            {/* 肌 */}
            {section === "skin" && (
              <div className="flex gap-3 justify-center flex-wrap">
                {SKIN_COLORS.map((hex, i) => (
                  <ColorSwatch
                    key={i}
                    hex={hex}
                    selected={config.skin === i}
                    onClick={() => update({ skin: i })}
                  />
                ))}
              </div>
            )}

            {/* 髪型 */}
            {section === "hair_style" && (
              <div className="grid grid-cols-5 gap-1.5 w-full">
                {HAIR_STYLE_LABELS.map((label, i) => (
                  <OptionPill
                    key={i}
                    label={label}
                    selected={config.hair_style === i}
                    onClick={() => update({ hair_style: i })}
                  />
                ))}
              </div>
            )}

            {/* 髪色 */}
            {section === "hair_color" && (
              <div className="grid grid-cols-6 gap-2 justify-items-center w-full">
                {HAIR_COLOR_OPTIONS.map(hc => (
                  <ColorSwatch
                    key={hc.key}
                    hex={hc.hex}
                    title={hc.label}
                    selected={config.hair_color === hc.key}
                    onClick={() => update({ hair_color: hc.key })}
                  />
                ))}
              </div>
            )}

            {/* 目 */}
            {section === "eyes" && (
              <div className="grid grid-cols-5 gap-1.5 w-full">
                {EYE_STYLE_LABELS.map((label, i) => (
                  <OptionPill
                    key={i}
                    label={label}
                    selected={config.eyes === i}
                    onClick={() => update({ eyes: i })}
                  />
                ))}
              </div>
            )}

            {/* 口 */}
            {section === "mouth" && (
              <div className="grid grid-cols-4 gap-2 w-full">
                {MOUTH_STYLE_LABELS.map((label, i) => (
                  <OptionPill
                    key={i}
                    label={label}
                    selected={config.mouth === i}
                    onClick={() => update({ mouth: i })}
                  />
                ))}
              </div>
            )}

            {/* ほっぺ */}
            {section === "cheeks" && (
              <div className="flex gap-4 justify-center">
                {/* あり */}
                <button
                  type="button"
                  onClick={() => update({ cheeks: true })}
                  className={`flex flex-col items-center gap-1.5 px-8 py-3 rounded-xl transition-all ${
                    config.cheeks
                      ? "bg-blue-600 text-white scale-105 shadow"
                      : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                  }`}
                >
                  {/* Pink cheek indicator */}
                  <span
                    className="w-8 h-5 rounded-full block opacity-80"
                    style={{ backgroundColor: "#FF9B9B" }}
                  />
                  <span className="text-[11px] font-semibold">あり</span>
                </button>

                {/* なし */}
                <button
                  type="button"
                  onClick={() => update({ cheeks: false })}
                  className={`flex flex-col items-center gap-1.5 px-8 py-3 rounded-xl transition-all ${
                    !config.cheeks
                      ? "bg-blue-600 text-white scale-105 shadow"
                      : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                  }`}
                >
                  <span className="w-8 h-5 block" />
                  <span className="text-[11px] font-semibold">なし</span>
                </button>
              </div>
            )}
          </div>

          {isPending && (
            <p className="text-[10px] text-zinc-400 text-center">保存中…</p>
          )}
        </div>
      )}
    </div>
  );
}
