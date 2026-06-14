import { getMonsterCollectionAction } from "./actions";
import MonstersClient from "./MonstersClient";

/** モンスター管理（手持ち・図鑑・パーティー編成・育成）。ホームのキャラエリアから開く */
export default async function MonstersPage() {
  const initial = await getMonsterCollectionAction();
  return <MonstersClient initial={initial} />;
}
