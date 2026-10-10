from pathlib import Path
import re

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import BaseDocTemplate, Frame, KeepTogether, PageBreak, Paragraph, Spacer, Table, TableStyle


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "TREASURY_USER_GUIDE.md"
OUTPUT = ROOT / "output" / "pdf" / "treasury-user-guide.pdf"


def esc(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def inline(text: str) -> str:
    value = esc(text)
    value = re.sub(r"`([^`]+)`", r"<font name='Courier'>\1</font>", value)
    value = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", value)
    return value


styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name="GuideTitle", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=25, leading=30, textColor=colors.HexColor("#0F172A"), alignment=TA_CENTER, spaceAfter=8))
styles.add(ParagraphStyle(name="GuideSubtitle", parent=styles["Normal"], fontName="Helvetica", fontSize=10, leading=14, textColor=colors.HexColor("#475569"), alignment=TA_CENTER, spaceAfter=18))
styles.add(ParagraphStyle(name="GuideH1", parent=styles["Heading1"], fontName="Helvetica-Bold", fontSize=16, leading=20, textColor=colors.HexColor("#0F766E"), spaceBefore=14, spaceAfter=7, keepWithNext=True))
styles.add(ParagraphStyle(name="GuideH2", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=12, leading=16, textColor=colors.HexColor("#1E3A5F"), spaceBefore=11, spaceAfter=5, keepWithNext=True))
styles.add(ParagraphStyle(name="GuideBody", parent=styles["BodyText"], fontName="Helvetica", fontSize=9.4, leading=13.5, textColor=colors.HexColor("#1E293B"), spaceAfter=6))
styles.add(ParagraphStyle(name="GuideBullet", parent=styles["BodyText"], fontName="Helvetica", fontSize=9.4, leading=13.5, leftIndent=13, firstLineIndent=-8, bulletIndent=4, textColor=colors.HexColor("#1E293B"), spaceAfter=3))
styles.add(ParagraphStyle(name="GuideStep", parent=styles["BodyText"], fontName="Helvetica", fontSize=9.4, leading=13.5, leftIndent=15, firstLineIndent=-12, textColor=colors.HexColor("#1E293B"), spaceAfter=3))


def footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(colors.HexColor("#CBD5E1"))
    canvas.line(doc.leftMargin, 13 * mm, A4[0] - doc.rightMargin, 13 * mm)
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#64748B"))
    canvas.drawString(doc.leftMargin, 8.5 * mm, "BOAT Treasury User Guide")
    canvas.drawRightString(A4[0] - doc.rightMargin, 8.5 * mm, f"Page {doc.page}")
    canvas.restoreState()


def build_story():
    lines = SOURCE.read_text(encoding="utf-8").splitlines()
    story = []
    index = 0
    while index < len(lines):
        line = lines[index].strip()
        if not line:
            index += 1
            continue
        if line.startswith("# "):
            story.append(Spacer(1, 18 * mm))
            story.append(Paragraph(inline(line[2:]), styles["GuideTitle"]))
            story.append(Paragraph("A practical handbook for daily cash control, transfers, payments, statements, and reconciliation.", styles["GuideSubtitle"]))
            story.append(Spacer(1, 4 * mm))
        elif line == "## Daily Treasury Routine":
            story.append(PageBreak())
            story.append(Paragraph(inline(line[3:]), styles["GuideH1"]))
        elif line.startswith("## "):
            story.append(Paragraph(inline(line[3:]), styles["GuideH1"]))
        elif line.startswith("### "):
            story.append(Paragraph(inline(line[4:]), styles["GuideH2"]))
        elif line.startswith("|"):
            table_lines = []
            while index < len(lines) and lines[index].strip().startswith("|"):
                table_lines.append(lines[index].strip())
                index += 1
            rows = []
            for row in table_lines:
                cells = [cell.strip() for cell in row.strip("|").split("|")]
                if all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells):
                    continue
                rows.append([Paragraph(inline(cell), styles["GuideBody"]) for cell in cells])
            if rows:
                table = Table(rows, colWidths=[40 * mm, 128 * mm] if len(rows[0]) == 2 else None, repeatRows=1, hAlign="LEFT")
                table.setStyle(TableStyle([
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0F766E")),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                    ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#CBD5E1")),
                    ("BACKGROUND", (0, 1), (-1, -1), colors.HexColor("#F8FAFC")),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 6),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                    ("TOPPADDING", (0, 0), (-1, -1), 5),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ]))
                story.append(table)
                story.append(Spacer(1, 5))
            continue
        elif re.match(r"^\d+\. ", line):
            number, text = line.split(". ", 1)
            story.append(Paragraph(inline(text), styles["GuideStep"], bulletText=f"{number}."))
        elif line.startswith("- "):
            story.append(Paragraph(inline(line[2:]), styles["GuideBullet"], bulletText="•"))
        else:
            story.append(Paragraph(inline(line), styles["GuideBody"]))
        index += 1
    return story


OUTPUT.parent.mkdir(parents=True, exist_ok=True)
doc = BaseDocTemplate(str(OUTPUT), pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=18 * mm, bottomMargin=20 * mm)
frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
doc.addPageTemplates([])
from reportlab.platypus import PageTemplate
doc.addPageTemplates([PageTemplate(id="guide", frames=[frame], onPage=footer)])
doc.build(build_story())
print(OUTPUT)
