import { Home } from "lucide-react";

export const Brand = ({ compact = false }) => (
  <div className="flex items-center gap-2.5">
    <div className="relative grid h-9 w-9 place-items-center rounded-lg bg-brand text-white">
      <Home className="h-5 w-5" strokeWidth={2.4} />
    </div>
    {!compact && (
      <div className="leading-none">
        <div className="brand-font text-[15px] font-extrabold tracking-tight text-brand">
          UNIQUE PRIME REALITY
        </div>
        <div className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-400">
          Property Consultants
        </div>
      </div>
    )}
  </div>
);
