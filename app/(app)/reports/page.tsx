import { getReportOptions } from "./data";
import { ReportsApp } from "./_components/ReportsApp";
import { IconDoc } from "@/lib/shared/icons";

export default async function ReportsPage() {
  const options = await getReportOptions();
  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <IconDoc size={24} className="text-brand" />
        <h1 className="text-2xl font-bold text-ink">รายงานสรรพสามิต (ภส.๐๗)</h1>
        <span className="rounded-full bg-raised px-2.5 py-1 text-xs text-faint">เอกสารสรรพากร (ภพ.30/ภงด./50ทวิ) ย้ายไปที่แท็บ “เอกสารสรรพากร” ในบัญชี</span>
      </div>
      <ReportsApp options={options} />
    </div>
  );
}
