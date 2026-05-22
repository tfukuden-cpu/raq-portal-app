/**
 * 稼働実績エクスポート → 勤怠管理ページへリダイレクト
 */
import { redirect } from "next/navigation";

export default function WorkRecordsPage() {
  redirect("/attendance/edit?tab=records");
}
