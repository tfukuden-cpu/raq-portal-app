/**
 * Supabase Admin クライアント（Service Role Key 使用）
 * RLS を完全バイパスするため、サーバーサイドの信頼できる処理のみで使用する。
 * 絶対にクライアント側コードからインポートしないこと。
 */
import { createClient } from "@supabase/supabase-js";

export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
