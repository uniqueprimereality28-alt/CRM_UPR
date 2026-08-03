export const StatCard = ({ label, value, sub, icon: Icon, accent = "brand", testId, delay = 0 }) => {
  const accents = {
    brand: "bg-brand-light text-brand",
    emerald: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
    slate: "bg-slate-100 text-slate-600",
    rose: "bg-rose-50 text-rose-600",
  };
  return (
    <div
      data-testid={testId}
      className="stagger-in rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-transform hover:-translate-y-[2px]"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-start justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</div>
        {Icon && (
          <div className={`grid h-8 w-8 place-items-center rounded-lg ${accents[accent]}`}>
            <Icon className="h-4 w-4" />
          </div>
        )}
      </div>
      <div className="brand-font mt-3 text-2xl font-bold text-slate-900">{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
};
