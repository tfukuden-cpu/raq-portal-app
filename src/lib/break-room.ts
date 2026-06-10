/**
 * 休憩室（定員制の箱）共通ヘルパー
 * break_room_uses は「入室中のみ行が存在」する。退室・休憩終了・退勤で必ず削除する。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any;

/** 休憩室の箱からスタッフを退出させる（行削除）。break_end が発生する全経路から呼ぶこと */
export async function releaseBreakRoomBox(
  admin: AdminClient,
  projectId: string,
  staffId: string,
  date: string, // YYYY-MM-DD (JST)
): Promise<void> {
  await admin
    .from("break_room_uses")
    .delete()
    .eq("project_id", projectId)
    .eq("staff_id", staffId)
    .eq("use_date", date);
}
