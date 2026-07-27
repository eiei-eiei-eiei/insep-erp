export function WorkspacePlaceholder({
  icon,
  title,
  phase,
  children,
}: {
  icon: string;
  title: string;
  phase: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <span className="text-3xl">{icon}</span>
        <h1 className="text-2xl font-bold text-slate-800">{title}</h1>
        <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700">
          {phase}
        </span>
      </div>
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm leading-relaxed text-slate-600">
        {children}
      </div>
    </div>
  );
}
