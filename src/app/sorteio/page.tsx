import SorteioClient from "@/features/sorteio/SorteioClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function SorteioPage() {
  return <SorteioClient />;
}
