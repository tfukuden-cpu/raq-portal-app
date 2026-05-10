/**
 * ブラウザ側で使う Supabase クライアント
 * クライアントコンポーネント（"use client"）から呼び出す
 */
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
