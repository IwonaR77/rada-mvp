import { CouncilorProfile } from "@/components/councilor-profile";

export default async function CouncilorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6 py-12">
      <CouncilorProfile councilorId={id} />
    </div>
  );
}
