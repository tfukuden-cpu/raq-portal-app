/**
 * モンスターガチャ（SPEC.md §6-7）
 * 一旦 福傳(S001) のみ開放。テスト後に GACHA_ALLOWED を外して全員へ。
 */
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getGachaStateAction } from "./actions";
import GachaClient from "./GachaClient";

const GACHA_ALLOWED = ["S001"];

export default async function GachaPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  if (!GACHA_ALLOWED.includes(staffId)) redirect("/dashboard");

  const state = await getGachaStateAction();
  return <GachaClient initialState={state} />;
}
