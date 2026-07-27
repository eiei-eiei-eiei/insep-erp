import { getReportOptions } from "./data";
import { ReportsApp } from "./_components/ReportsApp";

export default async function ReportsPage() {
  const options = await getReportOptions();
  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <span className="text-2xl">📄</span>
        <h1 className="text-2xl font-bold text-slate-800">รายงานสรรพสามิต (ภส.๐๗)</h1>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-500">เอกสารสรรพากร (ภพ.30/ภงด./50ทวิ) ย้ายไปที่แท็บ “เอกสารสรรพากร” ในบัญชี</span>
      </div>
      <ReportsApp options={options} />
    </div>
  );
}
