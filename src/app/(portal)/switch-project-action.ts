"use server";
import { setCurrentProjectId } from "@/lib/project-context";
import { revalidatePath } from "next/cache";

export async function switchProjectAction(projectId: string) {
  await setCurrentProjectId(projectId);
  revalidatePath("/", "layout");
}
