import { redirect } from "next/navigation";

export default async function ProjectSettingsRedirect(props: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await props.params;
  redirect(`/admin/${projectId}`);
}
