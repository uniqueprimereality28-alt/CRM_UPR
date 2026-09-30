"""
CSV + PDF export for AI Call Logs (interested / not interested lists).

PDF layout rules (so nothing is ever cut off):
- A4 landscape, every text cell is a wrapped Paragraph (no truncation, no "...").
- Rows may split across pages; the header row repeats on every page.
- Fixed column widths that add up to the printable width.

Hindi (Devanagari) script cannot be drawn by the built-in PDF fonts, so those
characters print as "?" in the PDF. The CSV always has the full original text.
"""
import csv
import io
import os
from datetime import datetime, timezone, timedelta
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

IST = timezone(timedelta(hours=5, minutes=30))

BRAND = colors.HexColor("#1a3fbf")
SLATE_900 = colors.HexColor("#0f172a")
SLATE_600 = colors.HexColor("#475569")
SLATE_400 = colors.HexColor("#94a3b8")
SLATE_100 = colors.HexColor("#f1f5f9")
LINE = colors.HexColor("#e2e8f0")

TEMP_COLORS = {
    "hot": colors.HexColor("#c2410c"), "warm": colors.HexColor("#b45309"),
    "cold": colors.HexColor("#475569"), "lost": colors.HexColor("#be123c"),
}
RESULT_COLORS = {
    "Interested": colors.HexColor("#047857"), "Not interested": colors.HexColor("#be123c"),
    "Undecided": colors.HexColor("#475569"),
}

# ------------------------------------------------------------------ fonts --
_FONT_CANDIDATES = [
    ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    ("/usr/share/fonts/dejavu/DejaVuSans.ttf", "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf"),
    ("/usr/share/fonts/TTF/DejaVuSans.ttf", "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf"),
]
_FONTS = None


def _fonts():
    """(regular, bold, unicode_ok). DejaVu if the server has it (handles rupee sign,
    accents, Cyrillic...), else the built-in Helvetica."""
    global _FONTS
    if _FONTS:
        return _FONTS
    for reg, bold in _FONT_CANDIDATES:
        if os.path.exists(reg) and os.path.exists(bold):
            try:
                pdfmetrics.registerFont(TTFont("CRM-Sans", reg))
                pdfmetrics.registerFont(TTFont("CRM-Sans-Bold", bold))
                _FONTS = ("CRM-Sans", "CRM-Sans-Bold", True)
                return _FONTS
            except Exception:  # noqa: BLE001
                pass
    _FONTS = ("Helvetica", "Helvetica-Bold", False)
    return _FONTS


def _txt(value, unicode_ok: bool) -> str:
    s = "" if value is None else str(value)
    s = s.replace("\r", "")
    if not unicode_ok:
        s = s.encode("latin-1", "replace").decode("latin-1")
    else:
        # DejaVu has no Devanagari — swap those for "?" instead of empty boxes
        s = "".join("?" if 0x0900 <= ord(ch) <= 0x097F else ch for ch in s)
    return escape(s).replace("\n", "<br/>")


# -------------------------------------------------------------------- CSV --
def _safe_cell(v):
    """Stop Excel treating text as a formula (=, +, -, @)."""
    s = "" if v is None else str(v)
    return "'" + s if s[:1] in ("=", "+", "-", "@") else s


def _when(iso):
    try:
        return datetime.fromisoformat(iso).astimezone(IST)
    except Exception:  # noqa: BLE001
        return None


def _conversation_text(c):
    lines = []
    for t in c.get("conversation") or []:
        who = {"agent": "AI agent", "customer": "Customer"}.get(t.get("speaker"), "Note")
        lines.append(f"{who}: {t.get('text', '')}")
    return "\n".join(lines)


CSV_HEADERS = [
    "Result", "Category", "Temperature", "AI score (0-100)", "Name", "Phone", "Date", "Time (IST)",
    "Direction", "Duration (sec)", "Connected", "Not connected reason", "Summary", "Remark",
    "Assigned to", "Conversation",
]


def build_csv(rows) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(CSV_HEADERS)
    for c in rows:
        dt = _when(c.get("started_at"))
        w.writerow([_safe_cell(x) for x in [
            c.get("result", ""), (c.get("category") or "").replace("_", " "),
            c.get("temperature") or "", c.get("ai_score") if c.get("ai_score") is not None else "",
            c.get("name") or "", c.get("phone") or "",
            dt.strftime("%Y-%m-%d") if dt else "", dt.strftime("%I:%M %p") if dt else "",
            c.get("direction") or "", c.get("duration_seconds") or 0,
            "Yes" if c.get("answered") else "No", c.get("not_connected_reason") or "",
            c.get("summary") or "", c.get("remark") or "", c.get("assigned_to_name") or "",
            _conversation_text(c),
        ]])
    return ("\ufeff" + buf.getvalue()).encode("utf-8")  # BOM so Excel shows Hindi correctly


# -------------------------------------------------------------------- PDF --
class _NumberedCanvas(rl_canvas.Canvas):
    """Adds 'Page X of Y' to every page."""

    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self._saved = []

    def showPage(self):
        self._saved.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        total = len(self._saved)
        for state in self._saved:
            self.__dict__.update(state)
            self.setFont("Helvetica", 7.5)
            self.setFillColor(SLATE_400)
            w, _h = self._pagesize
            self.drawRightString(w - 10 * mm, 6 * mm, f"Page {self._pageNumber} of {total}")
            self.drawString(10 * mm, 6 * mm, "Unique Prime Reality — AI Call Logs")
            super().showPage()
        super().save()


def build_pdf(rows, title: str, filters_text: str = "") -> bytes:
    reg, bold, uni = _fonts()
    T = lambda v: _txt(v, uni)  # noqa: E731

    cell = ParagraphStyle("cell", fontName=reg, fontSize=8, leading=10.5, textColor=SLATE_900, alignment=TA_LEFT)
    small = ParagraphStyle("small", parent=cell, fontSize=7.2, leading=9.2, textColor=SLATE_600)
    head = ParagraphStyle("head", parent=cell, fontName=bold, fontSize=7.6, leading=9.5, textColor=colors.white)
    h1 = ParagraphStyle("h1", fontName=bold, fontSize=18, leading=22, textColor=SLATE_900)
    sub = ParagraphStyle("sub", fontName=reg, fontSize=9, leading=12, textColor=SLATE_600)

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=landscape(A4), leftMargin=10 * mm, rightMargin=10 * mm,
        topMargin=10 * mm, bottomMargin=13 * mm, title=title, author="Unique Prime Reality CRM",
    )
    usable = landscape(A4)[0] - 20 * mm  # 277 mm

    story = [Paragraph(T(title), h1)]
    now = datetime.now(IST).strftime("%d %b %Y, %I:%M %p")
    n_int = sum(1 for r in rows if r.get("result") == "Interested")
    n_not = sum(1 for r in rows if r.get("result") == "Not interested")
    n_und = sum(1 for r in rows if r.get("result") == "Undecided")
    meta = f"Generated {now} IST &nbsp;|&nbsp; <b>{len(rows)}</b> calls &nbsp;|&nbsp; " \
           f"Interested: <b>{n_int}</b> &nbsp;|&nbsp; Not interested: <b>{n_not}</b>"
    if n_und:
        meta += f" &nbsp;|&nbsp; Undecided: <b>{n_und}</b>"
    story.append(Paragraph(meta, sub))
    if filters_text:
        story.append(Paragraph(T(filters_text), sub))
    story.append(Spacer(1, 5 * mm))

    # column widths (mm) — must add up to ~277
    widths_mm = [8, 40, 27, 14, 24, 26, 24, 84, 30]
    scale = usable / (sum(widths_mm) * mm)
    col_w = [w * mm * scale for w in widths_mm]

    header = [Paragraph(h, head) for h in (
        "#", "Name / phone", "When (IST)", "Length", "Connected", "Result", "Temp / score", "Summary", "Remark")]
    data = [header]
    style_cmds = [
        ("BACKGROUND", (0, 0), (-1, 0), BRAND),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LINEBELOW", (0, 1), (-1, -1), 0.4, LINE),
    ]

    for i, c in enumerate(rows, start=1):
        dt = _when(c.get("started_at"))
        dur = int(c.get("duration_seconds") or 0)
        who = f"<b>{T(c.get('name') or '—')}</b><br/>{T(c.get('phone') or '')}"
        if c.get("assigned_to_name"):
            who += f"<br/><font color='#4338ca'>→ {T(c['assigned_to_name'])}</font>"
        when = (f"{dt.strftime('%d %b %Y')}<br/>{dt.strftime('%I:%M %p')}" if dt else "—")
        if c.get("answered"):
            conn = "Connected"
            if "no_reply" in (c.get("signals") or []):
                conn += "<br/><font size='7' color='#64748b'>picked up, did not speak</font>"
        else:
            conn = "Not connected"
            if c.get("not_connected_reason"):
                conn += f"<br/><font size='7' color='#64748b'>{T(c['not_connected_reason'])}</font>"
        res = c.get("result") or ""
        rcol = RESULT_COLORS.get(res, SLATE_600).hexval()[2:]
        cat = (c.get("category") or "").replace("_", " ")
        result = f"<font color='#{rcol}'><b>{T(res)}</b></font><br/><font size='7' color='#64748b'>{T(cat)}</font>"
        temp = c.get("temperature")
        if temp:
            tcol = TEMP_COLORS.get(temp, SLATE_600).hexval()[2:]
            ts = f"<font color='#{tcol}'><b>{T(temp.capitalize())}</b></font>"
            if c.get("ai_score") is not None:
                ts += f"<br/>{int(c['ai_score'])}/100"
        else:
            ts = "—"
        data.append([
            Paragraph(str(i), small), Paragraph(who, cell), Paragraph(when, cell),
            Paragraph(f"{dur // 60}m {dur % 60:02d}s" if dur >= 60 else f"{dur}s", cell),
            Paragraph(conn, cell), Paragraph(result, cell), Paragraph(ts, cell),
            Paragraph(T(c.get("summary") or "—"), cell), Paragraph(T(c.get("remark") or ""), cell),
        ])
        if i % 2 == 0:
            style_cmds.append(("BACKGROUND", (0, i), (-1, i), SLATE_100))

    if len(data) == 1:
        story.append(Paragraph("No calls match these filters.", sub))
    else:
        tbl = Table(data, colWidths=col_w, repeatRows=1, splitByRow=1, splitInRow=1)
        tbl.setStyle(TableStyle(style_cmds))
        story.append(tbl)

    doc.build(story, canvasmaker=_NumberedCanvas)
    return buf.getvalue()
