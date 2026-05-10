"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

export type ViewMode = "staff" | "admin" | "ops";

/**
 * 表示モードをセット（全アカウント共通）
 * DB は変更せず cookie で制御。
 */
export async function setViewModeAction(mode: ViewMode): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set("rqp-view-mode", mode, { path: "/", maxAge: 60 * 60 * 24 });
  revalidatePath("/", "layout");
  // ops モードは案件一覧、それ以外はホームへ
  redirect(mode === "ops" ? "/admin" : "/dashboard");
}
