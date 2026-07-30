/** โครงหน้าว่างระหว่างโหลด workspace (ใช้ใน loading.tsx ทุกโดเมน) — กดเมนูแล้ว "ไปทันที" ไม่ค้างจอเดิม */
export function WorkspaceSkeleton() {
  return (
    <div className="animate-pulse" aria-label="กำลังโหลด" role="status">
      <div className="mb-4 flex items-center gap-3">
        <div className="h-8 w-8 rounded bg-slate-200" />
        <div className="h-7 w-40 rounded bg-slate-200" />
      </div>
      <div className="mb-5 flex flex-wrap gap-2 border-b border-slate-200 pb-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-8 w-24 rounded-lg bg-slate-100" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="mb-4 h-5 w-32 rounded bg-slate-200" />
            <div className="space-y-2">
              <div className="h-4 w-full rounded bg-slate-100" />
              <div className="h-4 w-5/6 rounded bg-slate-100" />
              <div className="h-4 w-2/3 rounded bg-slate-100" />
            </div>
          </div>
        ))}
      </div>
      <span className="sr-only">กำลังโหลด…</span>
    </div>
  );
}
