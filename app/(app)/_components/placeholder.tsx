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
        <h1 className="text-2xl font-bold text-ink">{title}</h1>
        <span className="rounded-full bg-warn-bg px-2.5 py-1 text-xs font-medium text-warn">
          {phase}
        </span>
      </div>
      <div className="rounded-2xl border border-dashed border-line bg-card p-6 text-sm leading-relaxed text-muted">
        {children}
      </div>
    </div>
  );
}
