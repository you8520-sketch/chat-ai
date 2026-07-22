import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";

export default async function SimulationCreatePage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const editRaw = (await searchParams).edit;
  const editNumber = Number(editRaw);
  const editId = Number.isInteger(editNumber) && editNumber > 0 ? editNumber : null;
  redirect(editId ? `/create?edit=${editId}` : "/create?kind=simulation");
}
