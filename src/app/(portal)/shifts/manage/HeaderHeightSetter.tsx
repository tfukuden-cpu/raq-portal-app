"use client";
import { useEffect, useRef } from "react";

/** sticky ページヘッダーの高さを --page-header-h として CSS 変数に設定する */
export default function HeaderHeightSetter({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const set = () =>
      document.documentElement.style.setProperty("--page-header-h", `${el.offsetHeight}px`);
    set();
    const obs = new ResizeObserver(set);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return <div ref={ref} className={className}>{children}</div>;
}
