import { createClient } from "@/lib/supabase/server";
import { getCurrentProjectId } from "@/lib/project-context";
import { redirect } from "next/navigation";
import { startOfTodayJST } from "@/lib/datetime";
import PunchInterface from "./PunchInterface";

type PunchType = "clock_in" | "clock_out" | "break_start" | "break_end";

export default async function PunchPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const projectId = await getCurrentProjectId();
  if (!projectId) redirect("/select-project");

  const todayJP = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
  }).format(new Date());

  const [{ data: staff }, { data: project }, { data: todayPunches }, { data: todayShift }] =
    await Promise.all([
      supabase
        .from("staffs")
        .select("name, display_name")
        .eq("id", staffId)
        .maybeSingle(),
      supabase
        .from("projects")
        .select("id, name")
        .eq("id", projectId)
        .maybeSingle(),
      supabase
        .from("punch_logs")
        .select("id, punch_type, recorded_at")
        .eq("staff_id", staffId)
        .eq("project_id", projectId)
        .gte("recorded_at", startOfTodayJST())
        .order("recorded_at", { ascending: false }),
      supabase
        .from("shifts")
        .select("shift_start, shift_end, shift_name")
        .eq("staff_id", staffId)
        .eq("project_id", projectId)
        .eq("shift_date", todayJP)
        .maybeSingle(),
    ]);

  const lastType = todayPunches?.[0]?.punch_type as PunchType | undefined;

  const statusLabel = (() => {
    if (!lastType) return "未出勤";
    if (lastType === "clock_in" || lastType === "break_end") return "勤務中";
    if (lastType === "break_start") return "休憩中";
    if (lastType === "clock_out") return "退勤済み";
    return "-";
  })();

  return (
    <PunchInterface
      staffName={staff?.display_name ?? staff?.name ?? staffId}
      projectName={project?.name ?? ""}
      lastType={lastType}
      statusLabel={statusLabel}
      todayPunches={todayPunches ?? []}
      scheduledStart={todayShift?.shift_start ?? null}
      scheduledEnd={todayShift?.shift_end ?? null}
      shiftName={todayShift?.shift_name ?? null}
    />
  );
}
