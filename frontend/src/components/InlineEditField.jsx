import { useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";

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
