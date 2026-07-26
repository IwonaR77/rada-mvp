import { redirect } from "next/navigation";

export default async function CouncilSessionsRedirect({
  params,
}: {
  params: Promise<{ councilId: string }>;
}) {
  const { councilId } = await params;
  redirect(`/rada/${councilId}`);
}
