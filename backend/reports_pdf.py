"""
Generates the styled "Daily Report" PDF (KPIs, two donut charts for calls
and talk time per agent, Super Agent of the Day, full per-agent table).

Usage from your existing reports route:

    from reports_pdf import generate_daily_report_pdf

    pdf_bytes = generate_daily_report_pdf(report_dict)

`report_dict` must have this shape (same fields your /reports/daily JSON
already returns for the WhatsApp text):

{
    "date": "03 Aug 2026",                 # the report's date (yesterday)
    "generated_for": "Tue, 04 Aug 2026",   # today's date, i.e. when it's sent
    "yesterday": {
        "new_leads": 3,
        "per_agent": [
            {"name": "Aarav Tomar", "calls": 12, "talk_time": "46m 10s"},
            ...  # every agent, not just top performers
        ],
        # "calls" and "talk_time" totals are computed automatically from
        # per_agent below — you don't need to pass them in.
    },
    "today_followups": 5,      # int, or len(list) if you have the list
    "overdue_followups": 2,    # int, or len(list) if you have the list
}
"""

import io
import re

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
)
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.graphics.shapes import Drawing, String, Circle
from reportlab.graphics.charts.piecharts import Pie

# ---------------------------------------------------------------- palette --
BRAND = colors.HexColor("#1a3fbf")
SLATE_900 = colors.HexColor("#0f172a")
SLATE_600 = colors.HexColor("#475569")
SLATE_400 = colors.HexColor("#94a3b8")
SLATE_100 = colors.HexColor("#f1f5f9")
ROSE = colors.HexColor("#e11d48")
SUPER_GOLD = colors.HexColor("#b45309")
SUPER_GOLD_BG = colors.HexColor("#fffbeb")
SUPER_GOLD_BORDER = colors.HexColor("#fde68a")

# Same fixed categorical palette as the live dashboard donut chart, so the
# PDF and the app visually match. Cycles if there are more agents than
# colors (unlikely with a real sales team, but safe either way).
AGENT_PALETTE = [
    "#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4",
    "#008300", "#4a3aa7", "#e34948",
]

_styles = getSampleStyleSheet()
_h1 = ParagraphStyle("h1", parent=_styles["Title"], fontName="Helvetica-Bold",
                      fontSize=22, textColor=SLATE_900, alignment=TA_LEFT, spaceAfter=2)
_sub = ParagraphStyle("sub", parent=_styles["Normal"], fontName="Helvetica",
                       fontSize=9.5, textColor=SLATE_400, spaceAfter=0)
_section_h = ParagraphStyle("section_h", parent=_styles["Normal"], fontName="Helvetica-Bold",
                             fontSize=11.5, textColor=SLATE_900, spaceBefore=14, spaceAfter=8)
_kpi_label = ParagraphStyle("kpi_label", parent=_styles["Normal"], fontName="Helvetica-Bold",
                             fontSize=7.3, textColor=SLATE_400, alignment=TA_LEFT, leading=9)
_kpi_value = ParagraphStyle("kpi_value", parent=_styles["Normal"], fontName="Helvetica-Bold",
                             fontSize=19, textColor=SLATE_900, alignment=TA_LEFT, leading=22, spaceBefore=3)
_body = ParagraphStyle("body", parent=_styles["Normal"], fontName="Helvetica",
                        fontSize=9.5, textColor=SLATE_600, leading=13)
_brand_name = ParagraphStyle("brand_name", parent=_styles["Normal"], fontName="Helvetica-Bold",
                              fontSize=13, textColor=BRAND, alignment=TA_LEFT, leading=15)
_brand_tag = ParagraphStyle("brand_tag", parent=_styles["Normal"], fontName="Helvetica",
                             fontSize=7, textColor=SLATE_400, alignment=TA_LEFT, leading=9)
_footer_style = ParagraphStyle("footer", parent=_styles["Normal"], fontName="Helvetica",
                                fontSize=7.5, textColor=SLATE_400, alignment=TA_CENTER)


# --------------------------------------------------------------- helpers --
def parse_duration(s):
    """'46m 10s' / '1h 5m 30s' / '38s' -> total seconds."""
    total = 0
    for num, unit in re.findall(r"(\d+)\s*([hms])", s or ""):
        n = int(num)
        total += n * (3600 if unit == "h" else 60 if unit == "m" else 1)
    return total


def format_duration(total_seconds):
    h, rem = divmod(int(total_seconds), 3600)
    m, s = divmod(rem, 60)
    parts = []
    if h:
        parts.append(f"{h}h")
    if m or h:
        parts.append(f"{m}m")
    parts.append(f"{s}s")
    return " ".join(parts)


def _donut_drawing(agents_sorted, value_key, center_value, center_label, size=170):
    """reportlab's Pie has no built-in donut mode, so draw a normal pie and
    mask the center with a white circle to fake the cutout."""
    d = Drawing(size, size)
    pie = Pie()
    pie.x = 10
    pie.y = 10
    pie.width = size - 20
    pie.height = size - 20
    pie.data = [a[value_key] for a in agents_sorted]
    pie.labels = None
    pie.sideLabels = False
    pie.slices.strokeWidth = 1.5
    pie.slices.strokeColor = colors.white
    for i, a in enumerate(agents_sorted):
        pie.slices[i].fillColor = colors.HexColor(AGENT_PALETTE[i % len(AGENT_PALETTE)])
    d.add(pie)

    cx = pie.x + pie.width / 2
    cy = pie.y + pie.height / 2
    d.add(Circle(cx, cy, pie.width * 0.32, fillColor=colors.white, strokeColor=None))
    d.add(String(cx, cy + 3, center_value, fontName="Helvetica-Bold",
                  fontSize=13, fillColor=SLATE_900, textAnchor="middle"))
    d.add(String(cx, cy - 10, center_label, fontName="Helvetica",
                  fontSize=7, fillColor=SLATE_400, textAnchor="middle"))
    return d


def _donut_with_legend(agents_sorted, value_key, center_value, center_label, fmt_fn=str):
    total = sum(a[value_key] for a in agents_sorted)
    donut = _donut_drawing(agents_sorted, value_key, center_value, center_label)

    legend_cells = []
    for i, a in enumerate(agents_sorted):
        pct = round((a[value_key] / total) * 100) if total else 0
        swatch = AGENT_PALETTE[i % len(AGENT_PALETTE)]
        legend_cells.append([Paragraph(
            f'<font color="{swatch}">&#9632;</font>&nbsp; {a["name"]} &mdash; {fmt_fn(a[value_key])} ({pct}%)',
            ParagraphStyle("legend", parent=_body, fontSize=9, leading=15),
        )])
    legend_tbl = Table(legend_cells, colWidths=[95 * mm])
    legend_tbl.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 1),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))

    row = Table([[donut, legend_tbl]], colWidths=[75 * mm, 103 * mm])
    row.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
    ]))
    return row


def _kpi_card(label, value, accent=SLATE_900):
    t = Table(
        [[Paragraph(label, _kpi_label)],
         [Paragraph(value, ParagraphStyle("v", parent=_kpi_value, textColor=accent))]],
        colWidths=[42 * mm],
    )
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.white),
        ("BOX", (0, 0), (-1, -1), 0.75, colors.HexColor("#e2e8f0")),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 12),
    ]))
    return t


# ------------------------------------------------------------- main API --
def generate_daily_report_pdf(report: dict) -> bytes:
    """Builds the full styled Daily Report PDF and returns raw PDF bytes."""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        topMargin=16 * mm, bottomMargin=14 * mm,
        leftMargin=16 * mm, rightMargin=16 * mm,
        title=f"Daily Report - {report['date']}",
    )
    story = []

    # Header
    header_tbl = Table(
        [[Paragraph("UNIQUE PRIME REALITY", _brand_name),
          Paragraph(report["generated_for"],
                    ParagraphStyle("d", parent=_body, alignment=TA_LEFT,
                                   textColor=SLATE_400, fontSize=8.5))]],
        colWidths=[120 * mm, 42 * mm],
    )
    header_tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (1, 0), (1, 0), "RIGHT"),
    ]))
    story.append(header_tbl)
    story.append(Paragraph("PROPERTY CONSULTANTS", _brand_tag))
    story.append(Spacer(1, 10))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#e2e8f0")))
    story.append(Spacer(1, 14))

    story.append(Paragraph("Daily Report", _h1))
    story.append(Paragraph(f"For {report['date']} &nbsp;\u00b7&nbsp; Auto-prepared every morning at 9 AM", _sub))
    story.append(Spacer(1, 18))

    # Totals derived from the full per-agent list, so the KPI row always
    # matches the team total shown in the charts/table below.
    y = report["yesterday"]
    agents_sorted = sorted(y["per_agent"], key=lambda a: a["calls"], reverse=True)
    for a in agents_sorted:
        a["_secs"] = parse_duration(a["talk_time"])
    total_calls = sum(a["calls"] for a in agents_sorted)
    total_secs = sum(a["_secs"] for a in agents_sorted)

    kpi_row = Table(
        [[
            _kpi_card("YESTERDAY&#39;S CALLS", str(total_calls)),
            _kpi_card("TALK TIME", format_duration(total_secs)),
            _kpi_card("NEW LEADS", str(y["new_leads"])),
            _kpi_card("FOLLOW-UPS TODAY", str(report["today_followups"]),
                      accent=ROSE if report["overdue_followups"] else SLATE_900),
        ]],
        colWidths=[43 * mm] * 4,
    )
    kpi_row.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3),
    ]))
    story.append(kpi_row)

    if report["overdue_followups"]:
        story.append(Spacer(1, 6))
        story.append(Paragraph(
            f'<font color="#e11d48"><b>{report["overdue_followups"]} overdue</b></font> follow-up(s) need attention',
            _body,
        ))

    # Two donuts: calls by agent, talk time by agent
    story.append(Paragraph("Calls by agent", _section_h))
    story.append(_donut_with_legend(
        agents_sorted, "calls", str(total_calls), "calls", fmt_fn=str))

    story.append(Paragraph("Talk time by agent", _section_h))
    story.append(_donut_with_legend(
        agents_sorted, "_secs", format_duration(total_secs), "talk time",
        fmt_fn=format_duration))
    story.append(Spacer(1, 6))

    # Super Agent of the Day
    top_calls_agent = max(agents_sorted, key=lambda a: a["calls"])
    top_talk_agent = max(agents_sorted, key=lambda a: a["_secs"])

    story.append(Paragraph("Super Agent of the Day", _section_h))
    if top_calls_agent["name"] == top_talk_agent["name"]:
        text = (f'<b>{top_calls_agent["name"]}</b> &mdash; most calls '
                f'({top_calls_agent["calls"]}) and most talk time ({top_calls_agent["talk_time"]})')
        tbl = Table([[Paragraph(text, ParagraphStyle("s1", parent=_body, textColor=SUPER_GOLD, fontSize=10.5))]],
                    colWidths=[178 * mm])
        tbl.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), SUPER_GOLD_BG),
            ("BOX", (0, 0), (-1, -1), 0.75, SUPER_GOLD_BORDER),
            ("LEFTPADDING", (0, 0), (-1, -1), 14), ("RIGHTPADDING", (0, 0), (-1, -1), 14),
            ("TOPPADDING", (0, 0), (-1, -1), 10), ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ]))
        story.append(tbl)
    else:
        cell1 = Paragraph(
            f'<font color="#b45309"><b>Most calls</b></font><br/>{top_calls_agent["name"]} &mdash; {top_calls_agent["calls"]} calls',
            ParagraphStyle("sa", parent=_body, fontSize=9.5, leading=13))
        cell2 = Paragraph(
            f'<font color="#b45309"><b>Most talk time</b></font><br/>{top_talk_agent["name"]} &mdash; {top_talk_agent["talk_time"]}',
            ParagraphStyle("sb", parent=_body, fontSize=9.5, leading=13))
        tbl = Table([[cell1, cell2]], colWidths=[89 * mm, 89 * mm])
        tbl.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), SUPER_GOLD_BG),
            ("BOX", (0, 0), (-1, -1), 0.75, SUPER_GOLD_BORDER),
            ("LINEAFTER", (0, 0), (0, 0), 0.75, SUPER_GOLD_BORDER),
            ("LEFTPADDING", (0, 0), (-1, -1), 14), ("RIGHTPADDING", (0, 0), (-1, -1), 14),
            ("TOPPADDING", (0, 0), (-1, -1), 10), ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ]))
        story.append(tbl)
    story.append(Spacer(1, 16))

    # Full per-agent table (scales to any number of agents; header repeats
    # across pages automatically via repeatRows)
    story.append(Paragraph(
        f"Per-agent breakdown &nbsp;<font color='#94a3b8' size='9'>({len(agents_sorted)} agents)</font>",
        _section_h))

    rows = [["#", "Agent", "Calls", "Talk time"]]
    for i, a in enumerate(agents_sorted, 1):
        rows.append([str(i), a["name"], str(a["calls"]), a["talk_time"]])
    rows.append(["", "Total", str(total_calls), format_duration(total_secs)])

    tbl = Table(rows, colWidths=[9 * mm, 77 * mm, 25 * mm, 67 * mm], repeatRows=1)
    n = len(agents_sorted)
    style_cmds = [
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 8),
        ("TEXTCOLOR", (0, 0), (-1, 0), SLATE_400),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 8),
        ("TOPPADDING", (0, 0), (-1, 0), 4),
        ("LINEBELOW", (0, 0), (-1, 0), 0.75, colors.HexColor("#e2e8f0")),
        ("FONTNAME", (0, 1), (-1, -2), "Helvetica"),
        ("FONTSIZE", (0, 1), (-1, -2), 9.5),
        ("TEXTCOLOR", (0, 1), (1, -2), SLATE_600),
        ("TEXTCOLOR", (2, 1), (-1, -2), SLATE_900),
        ("TOPPADDING", (0, 1), (-1, -2), 7),
        ("BOTTOMPADDING", (0, 1), (-1, -2), 7),
        ("TEXTCOLOR", (0, 1), (0, -2), SLATE_400),
        ("FONTSIZE", (0, 1), (0, -2), 8),
        ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, -1), (-1, -1), 9.5),
        ("TEXTCOLOR", (0, -1), (-1, -1), SLATE_900),
        ("TOPPADDING", (0, -1), (-1, -1), 9),
        ("BOTTOMPADDING", (0, -1), (-1, -1), 9),
        ("LINEABOVE", (0, -1), (-1, -1), 0.75, colors.HexColor("#e2e8f0")),
        ("ALIGN", (2, 0), (2, -1), "RIGHT"),
        ("ALIGN", (0, 0), (0, -1), "CENTER"),
    ]
    for i in range(1, n + 1):
        if i % 2 == 0:
            style_cmds.append(("BACKGROUND", (0, i), (-1, i), SLATE_100))
    tbl.setStyle(TableStyle(style_cmds))
    story.append(tbl)

    story.append(Spacer(1, 26))
    story.append(HRFlowable(width="100%", thickness=0.75, color=colors.HexColor("#e2e8f0")))
    story.append(Spacer(1, 8))
    story.append(Paragraph(
        "Unique Prime Reality &middot; CRM Daily Report &middot; Generated automatically, no action needed",
        _footer_style,
    ))

    doc.build(story)
    return buf.getvalue()
