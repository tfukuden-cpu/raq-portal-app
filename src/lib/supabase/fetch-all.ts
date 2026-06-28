/**
 * PostgREST は1クエリで最大1000行しか返さない（`.limit(N)` で N>1000 を指定しても
 * サーバー側の db-max-rows=1000 で切られる）。`shifts`（1案件1ヶ月で約3700行）や
 * `punch_logs`（約4100行）のように数千行になるテーブルを、全スタッフ×1ヶ月以上の
 * 範囲で取ると先頭1000行で切れてデータが欠落する。
 *
 * このヘルパーは 1000 行ずつ `.range()` でページングして全件取得する。
 * `page(from, to)` には「`.range(from, to)` まで付けたクエリ」を返す関数を渡す。
 * 安定したページングのため、page 内で必ず `.order(...)` を指定すること。
 *
 * 例:
 *   const shifts = await fetchAllPaged((from, to) =>
 *     admin.from("shifts").select("staff_id, shift_date, shift_name")
 *       .eq("project_id", projectId)
 *       .gte("shift_date", dateFrom).lte("shift_date", dateTo)
 *       .order("shift_date").range(from, to));
 */
export async function fetchAllPaged<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const all: T[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await page(offset, offset + PAGE - 1);
    if (error || !data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
  }
  return all;
}
