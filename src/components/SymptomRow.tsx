"use client";

export type Symptoms = {
  fever: boolean;
  fever_temp: string;
  headache: boolean;
  cough: boolean;
  fatigue: boolean;
  nausea: boolean;
  other: boolean;
  other_detail: string;
};

export const initSymptoms: Symptoms = {
  fever: false, fever_temp: "",
  headache: false, cough: false, fatigue: false,
  nausea: false, other: false, other_detail: "",
};

export function SymptomRow({
  label,
  checked,
  onToggle,
  children,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-sm text-zinc-700 dark:text-zinc-300">{label}</span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => !checked && onToggle()}
            className={[
              "px-3 py-1 rounded-lg text-xs font-semibold border transition-colors",
              checked
                ? "bg-red-50 dark:bg-red-900/30 border-red-400 text-red-700 dark:text-red-300"
                : "border-zinc-200 dark:border-zinc-700 text-zinc-400 hover:border-zinc-300",
            ].join(" ")}
          >有</button>
          <button
            type="button"
            onClick={() => checked && onToggle()}
            className={[
              "px-3 py-1 rounded-lg text-xs font-semibold border transition-colors",
              !checked
                ? "bg-zinc-100 dark:bg-zinc-800 border-zinc-400 text-zinc-700 dark:text-zinc-200"
                : "border-zinc-200 dark:border-zinc-700 text-zinc-400 hover:border-zinc-300",
            ].join(" ")}
          >無</button>
        </div>
      </div>
      {checked && children}
    </div>
  );
}
