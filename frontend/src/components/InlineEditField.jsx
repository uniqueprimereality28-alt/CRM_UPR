import { useEffect, useRef, useState } from "react";
import { Check, Pencil, X } from "lucide-react";

// Click-to-edit field used in leads tables/cards so a salesperson can fix a
// name, remark or budget right from the list — no need to open the lead
// (and its call interface) just to change these three fields.
export const InlineEditField = ({
  value,
  onSave,
  type = "text",
  placeholder = "—",
  emptyLabel,
  testId,
  displayClassName = "",
  inputClassName = "",
  formatDisplay,
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!editing) setDraft(value ?? "");
  }, [value, editing]);

  useEffect(() => {
    if (editing && ref.current) {
      ref.current.focus();
      if (type !== "textarea") ref.current.select();
    }
  }, [editing, type]);

  const startEdit = () => setEditing(true);

  const cancel = () => {
    setDraft(value ?? "");
    setEditing(false);
  };

  const commit = async () => {
    const next = type === "number" ? (draft === "" ? null : Number(draft)) : draft;
    const prev = type === "number" ? (value ?? null) : (value ?? "");
    if (next === prev) { setEditing(false); return; }
    setSaving(true);
    try {
      await onSave(next);
    } finally {
      setSaving(false);
      setEditing(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") { e.preventDefault(); cancel(); }
    else if (e.key === "Enter" && type !== "textarea") { e.preventDefault(); e.target.blur(); }
  };

  if (editing) {
    const commonProps = {
      ref,
      value: draft ?? "",
      onChange: (e) => setDraft(e.target.value),
      onBlur: commit,
      onKeyDown,
      disabled: saving,
      "data-testid": testId,
      className: `w-full rounded-md border border-brand/40 bg-white px-2 py-1 text-sm outline-none ring-2 ring-brand/20 ${inputClassName}`,
    };
    return type === "textarea" ? (
      <textarea rows={2} {...commonProps} />
    ) : (
      <input type={type === "number" ? "number" : "text"} {...commonProps} />
    );
  }

  const display = value
    ? (formatDisplay ? formatDisplay(value) : value)
    : (emptyLabel || placeholder);

  return (
    <button
      type="button"
      onClick={startEdit}
      data-testid={testId ? `${testId}-display` : undefined}
      className={`group flex w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-slate-100 ${
        value ? "" : "text-slate-300"
      } ${displayClassName}`}
    >
      <span className="min-w-0 flex-1 truncate">{display}</span>
      <Pencil className="h-3 w-3 shrink-0 text-slate-300 opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
};

// Budget-specific inline editor: an amount input plus a Lac/Cr unit
// dropdown, since that's how budgets are normally quoted (e.g. "50 L" or
// "1.2 Cr") rather than typing the full rupee figure.
const rupeesToAmountUnit = (rupees) => {
  if (!rupees) return { amount: "", unit: "L" };
  if (rupees >= 10000000) return { amount: String(round2(rupees / 10000000)), unit: "Cr" };
  return { amount: String(round2(rupees / 100000)), unit: "L" };
};
const round2 = (n) => Math.round(n * 100) / 100;
const amountUnitToRupees = (amount, unit) => {
  if (amount === "" || amount === null || amount === undefined) return null;
  const n = Number(amount);
  if (Number.isNaN(n)) return null;
  return Math.round(n * (unit === "Cr" ? 10000000 : 100000));
};

export const InlineBudgetField = ({
  value,
  onSave,
  emptyLabel = "Add budget",
  testId,
  displayClassName = "",
  formatDisplay,
}) => {
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState("");
  const [unit, setUnit] = useState("L");
  const [saving, setSaving] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!editing) {
      const r = rupeesToAmountUnit(value);
      setAmount(r.amount);
      setUnit(r.unit);
    }
  }, [value, editing]);

  useEffect(() => {
    if (editing && ref.current) { ref.current.focus(); ref.current.select(); }
  }, [editing]);

  const startEdit = () => setEditing(true);
  const cancel = () => {
    const r = rupeesToAmountUnit(value);
    setAmount(r.amount);
    setUnit(r.unit);
    setEditing(false);
  };

  const commit = async () => {
    const next = amountUnitToRupees(amount, unit);
    const prev = value ?? null;
    if (next === prev) { setEditing(false); return; }
    setSaving(true);
    try {
      await onSave(next);
    } finally {
      setSaving(false);
      setEditing(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") { e.preventDefault(); cancel(); }
    else if (e.key === "Enter") { e.preventDefault(); commit(); }
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          ref={ref}
          type="number"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={saving}
          data-testid={testId}
          placeholder="0"
          className="w-16 rounded-md border border-brand/40 bg-white px-1.5 py-1 text-sm outline-none ring-2 ring-brand/20"
        />
        <select
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={saving}
          data-testid={testId ? `${testId}-unit` : undefined}
          className="rounded-md border border-brand/40 bg-white px-1 py-1 text-xs font-semibold outline-none ring-2 ring-brand/20"
        >
          <option value="L">Lac</option>
          <option value="Cr">Cr</option>
        </select>
        <button type="button" onClick={commit} disabled={saving} aria-label="Save budget"
          className="rounded-md p-1 text-emerald-600 hover:bg-emerald-50">
          <Check className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={cancel} disabled={saving} aria-label="Cancel"
          className="rounded-md p-1 text-slate-400 hover:bg-slate-100">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  const display = value ? (formatDisplay ? formatDisplay(value) : value) : emptyLabel;

  return (
    <button
      type="button"
      onClick={startEdit}
      data-testid={testId ? `${testId}-display` : undefined}
      className={`group flex w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-slate-100 ${
        value ? "" : "text-slate-300"
      } ${displayClassName}`}
    >
      <span className="min-w-0 flex-1 truncate">{display}</span>
      <Pencil className="h-3 w-3 shrink-0 text-slate-300 opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
};
