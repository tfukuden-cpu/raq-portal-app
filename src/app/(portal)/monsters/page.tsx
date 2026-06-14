import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getMonsterCollectionAction } from "./actions";
import MonstersClient from "./MonstersClient";

// ガチャと揃えて一旦 福傳(O002) のみ。全員開放時は撤去（ホームの「なかま」アイコンの分岐も）
const MONSTERS_ALLOWED = ["O002"];

/** モンスター管理（手持ち・図鑑・パーティー編成・育成）。ホームのキャラエリアから開く */
export default async function MonstersPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  if (!MONSTERS_ALLOWED.includes(staffId)) redirect("/dashboard");

  const initial = await getMonsterCollectionAction();
  return <MonstersClient initial={initial} />;
}
