/**
 * 認証まわりの既定値（plain モジュール）
 *
 * ⚠️ このファイルには `"use server"` を付けないこと。
 *    `"use server"` ファイルからは非async値を export できず（ビルドエラー）、
 *    クライアントコンポーネントからも import できなくなる。
 *    サーバーアクション側・UI側の双方がここから import する前提。
 */

/**
 * 新規登録・パスワード初期化で設定する初期パスワード。
 *
 * ⚠️ Supabase Auth の最低文字数は 6。5文字以下にすると
 *    `admin.auth.admin.createUser()` / `updateUserById()` が
 *    "Password should be at least 6 characters." で必ず失敗する。
 *    （2026-09-27 に "1234" のままだったため新規登録が全滅した）
 *
 * 画面に出す文言もこの定数を使うこと（リテラルを書くと値を変えたときに食い違う）。
 */
export const INITIAL_PASSWORD = "123456";
