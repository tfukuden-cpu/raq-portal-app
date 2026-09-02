/**
 * 「現在の案件ID」を返す
 *
 * I Works は IDOM（P001）専用の単一案件アプリ。
 * 2026-09-01 に複数案件対応をやめ、案件の選択・追加・切替を廃止した
 * （P002 MUNDO PIXAR は削除済み。バックアップは _backup_p002_20260901_* テーブル）。
 *
 * DBの各テーブルは project_id を持ったままなので、ここで常に P001 を返すことで
 * 既存の全クエリ（.eq("project_id", projectId)）をそのまま動かしている。
 * 再び複数案件に戻す場合は、Cookie 方式に戻したうえで選択画面を復活させること。
 */
import { cookies } from "next/headers";

/** 唯一の案件ID */
export const PROJECT_ID = "P001";

const COOKIE_NAME = "rqp_project_id";

export async function getCurrentProjectId(): Promise<string | null> {
  return PROJECT_ID;
}

/** 単一案件のため何もしない（呼び出し元の互換性のために残す） */
export async function setCurrentProjectId(_projectId: string): Promise<void> {
  return;
}

/** ログアウト時に旧Cookieが残っていれば掃除する */
export async function clearCurrentProjectId(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}
