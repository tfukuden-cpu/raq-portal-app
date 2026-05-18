/**
 * 旧打刻ページ → ダッシュボードにリダイレクト
 * 打刻は現場端末（/punch/[projectId]）で行います
 */
import { redirect } from "next/navigation";

export default function OldPunchPage() {
  redirect("/dashboard");
}
