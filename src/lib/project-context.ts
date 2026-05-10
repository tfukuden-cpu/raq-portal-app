/**
 * 「現在選択中の案件ID」を Cookie で管理する
 * Cookie名: rqp_project_id
 */
import { cookies } from "next/headers";

const COOKIE_NAME = "rqp_project_id";
const MAX_AGE = 60 * 60 * 24 * 30; // 30日

export async function getCurrentProjectId(): Promise<string | null> {
  const store = await cookies();
  return store.get(COOKIE_NAME)?.value ?? null;
}

export async function setCurrentProjectId(projectId: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, projectId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function clearCurrentProjectId(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}
