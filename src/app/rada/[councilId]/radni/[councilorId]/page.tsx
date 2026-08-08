import { CouncilorProfile } from "@/components/councilor-profile";

export default async function RadniDetailPage({
  params,
}: {
  params: Promise<{ councilId: string; councilorId: string }>;
}) {
  const { councilorId } = await params;
  return <CouncilorProfile councilorId={councilorId} showBackLink={false} />;
}
