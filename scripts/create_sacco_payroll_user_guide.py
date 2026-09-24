from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import KeepTogether, ListFlowable, ListItem, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


OUTPUT = Path(r"C:\Projects\BOAT\output\pdf\sacco-payroll-user-guide.pdf")


def footer(canvas, document):
    canvas.saveState()
    canvas.setStrokeColor(colors.HexColor("#CBD5E1"))
    canvas.line(18 * mm, 14 * mm, A4[0] - 18 * mm, 14 * mm)
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#64748B"))
    canvas.drawString(18 * mm, 9 * mm, "BOAT SACCO Payroll User Guide")
    canvas.drawRightString(A4[0] - 18 * mm, 9 * mm, f"Page {document.page}")
    canvas.restoreState()


def bullet_list(items, styles):
    return ListFlowable(
        [ListItem(Paragraph(item, styles["Body"]), leftIndent=5 * mm) for item in items],
        bulletType="bullet",
        leftIndent=5 * mm,
        bulletFontName="Helvetica",
        bulletFontSize=8,
        spaceBefore=2 * mm,
        spaceAfter=4 * mm,
    )


def numbered_list(items, styles):
    return ListFlowable(
        [ListItem(Paragraph(item, styles["Body"]), leftIndent=5 * mm) for item in items],
        bulletType="1",
        start="1",
        leftIndent=6 * mm,
        spaceBefore=2 * mm,
        spaceAfter=4 * mm,
    )


def main():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    base = getSampleStyleSheet()
    styles = {
        "Title": ParagraphStyle("GuideTitle", parent=base["Title"], fontName="Helvetica-Bold", fontSize=23, leading=28, alignment=TA_CENTER, textColor=colors.HexColor("#0F172A"), spaceAfter=3 * mm),
        "Subtitle": ParagraphStyle("GuideSubtitle", parent=base["Normal"], fontName="Helvetica", fontSize=10.5, leading=15, alignment=TA_CENTER, textColor=colors.HexColor("#475569"), spaceAfter=9 * mm),
        "H1": ParagraphStyle("GuideH1", parent=base["Heading1"], fontName="Helvetica-Bold", fontSize=15, leading=19, textColor=colors.HexColor("#0F766E"), spaceBefore=6 * mm, spaceAfter=3 * mm),
        "H2": ParagraphStyle("GuideH2", parent=base["Heading2"], fontName="Helvetica-Bold", fontSize=11.5, leading=15, textColor=colors.HexColor("#1E293B"), spaceBefore=4 * mm, spaceAfter=2 * mm),
        "Body": ParagraphStyle("GuideBody", parent=base["BodyText"], fontName="Helvetica", fontSize=9.5, leading=14, textColor=colors.HexColor("#334155"), spaceAfter=2 * mm),
        "Small": ParagraphStyle("GuideSmall", parent=base["BodyText"], fontName="Helvetica", fontSize=8.5, leading=12, textColor=colors.HexColor("#475569")),
        "TableHeader": ParagraphStyle("GuideTableHeader", parent=base["BodyText"], fontName="Helvetica-Bold", fontSize=8.5, leading=12, textColor=colors.white),
        "Callout": ParagraphStyle("GuideCallout", parent=base["BodyText"], fontName="Helvetica-Bold", fontSize=9.5, leading=14, textColor=colors.HexColor("#0F5132")),
    }

    doc = SimpleDocTemplate(str(OUTPUT), pagesize=A4, rightMargin=18 * mm, leftMargin=18 * mm, topMargin=16 * mm, bottomMargin=20 * mm, title="SACCO Payroll User Guide", author="BOAT")
    story = []
    story.extend([
        Spacer(1, 8 * mm),
        Paragraph("SACCO Payroll User Guide", styles["Title"]),
        Paragraph("A practical guide for preparing, approving, paying, and recording each payroll cycle in BOAT.", styles["Subtitle"]),
    ])

    callout = Table([[Paragraph("<b>Before you begin:</b> Payroll access, employee details, salary values, statutory settings, and GL mappings must be reviewed by an authorized user. Do not post a payroll run until the figures have been checked.", styles["Callout"])]], colWidths=[174 * mm])
    callout.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#ECFDF5")),
        ("BOX", (0, 0), (-1, -1), 0.7, colors.HexColor("#6EE7B7")),
        ("LEFTPADDING", (0, 0), (-1, -1), 5 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 4 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4 * mm),
    ]))
    story.extend([callout, Spacer(1, 5 * mm), Paragraph("The payroll cycle", styles["H1"]), Paragraph("Use this sequence for every monthly or other defined pay period.", styles["Body"]), numbered_list([
        "<b>Confirm access.</b> An administrator sets who may prepare, approve, and post payroll under Approval rights.",
        "<b>Set up employees.</b> Add staff and mark only eligible staff as <b>On payroll</b>.",
        "<b>Set salary structure.</b> Enter basic salary, allowances, and recurring deductions for every employee.",
        "<b>Check settings and accounting.</b> Confirm PAYE, NSSF, working days, and GL accounts before you post.",
        "<b>Create the payroll period.</b> Add the dated month or pay cycle that you are about to process.",
        "<b>Process payroll.</b> Prepare the run, calculate it, and review each payslip line.",
        "<b>Review and approve.</b> Record exceptions and obtain approval from the authorized approver.",
        "<b>Pay employees.</b> Prepare the payment schedule, record payment references, and mark payments complete only after payment occurs.",
        "<b>Handle statutory deductions.</b> Prepare PAYE and NSSF remittances and record amounts paid.",
        "<b>Report and audit.</b> Use payroll reports and the audit trail for management, compliance, and record keeping.",
    ], styles)])

    story.append(Paragraph("1. Access and responsibilities", styles["H1"]))
    story.append(Paragraph("Payroll duties should be separated wherever practical. The user who prepares payroll should not be the only person approving or posting it.", styles["Body"]))
    responsibilities = [
        ["Role", "Typical responsibility"],
        ["Payroll preparer", "Maintains employee records, salary structure, periods, and calculated runs."],
        ["Approver", "Reviews calculated payroll, records exceptions, and approves it for payment."],
        ["Poster / accountant", "Posts approved payroll to the general ledger after confirming the accounting mappings."],
        ["Payment officer", "Prepares the payment schedule and records completed payments and references."],
    ]
    responsibility_table = Table([[Paragraph(cell, styles["TableHeader"] if row_index == 0 else styles["Small"]) for cell in row] for row_index, row in enumerate(responsibilities)], colWidths=[43 * mm, 131 * mm], repeatRows=1)
    responsibility_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0F766E")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#CBD5E1")),
        ("BACKGROUND", (0, 1), (-1, -1), colors.white),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 3 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 2.5 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5 * mm),
    ]))
    story.append(responsibility_table)

    story.append(Paragraph("2. Set up before the first run", styles["H1"]))
    story.append(Paragraph("Employees", styles["H2"]))
    story.append(bullet_list([
        "Open <b>Payroll - Employees</b> and add an employee if they do not already exist in the staff list. Adding a payroll employee does not create a BOAT login.",
        "Confirm the employee&apos;s name, employee code, department, and staff type before saving.",
        "Use <b>On payroll</b> only for staff who should be included in the next calculation.",
    ], styles))
    story.append(Paragraph("Salary Structure", styles["H2"]))
    story.append(bullet_list([
        "Enter basic salary and applicable housing, transport, and responsibility allowances.",
        "Add recurring deductions only when they are valid for every payroll run until changed.",
        "Review salary values carefully. They feed gross pay and the statutory calculations.",
    ], styles))
    story.append(Paragraph("Settings & Accounting", styles["H2"]))
    story.append(bullet_list([
        "Confirm statutory settings such as PAYE and NSSF, including any applicable contribution ceiling.",
        "Set the monthly working days used when days absent are recorded during processing.",
        "Map salary expense, employer NSSF expense, PAYE payable, NSSF payable, and net-salary payment accounts before posting.",
    ], styles))

    story.append(Paragraph("3. Process a payroll period", styles["H1"]))
    story.append(Paragraph("Create a clearly named period, for example, <b>September 2026</b>, with the correct start and end dates. Only one payroll run is maintained for each period.", styles["Body"]))
    story.append(numbered_list([
        "Open <b>Payroll - Process Payroll</b> and select the correct period.",
        "Prepare the run if one does not already exist.",
        "Select <b>Calculate</b> to create the payslip lines from employee profiles, statutory settings, and active staff loans.",
        "Review gross pay, PAYE, NSSF, loan deductions, and net pay for every employee.",
        "Where applicable, record days absent. The system uses the working-days setting to calculate the adjustment.",
        "Open an employee&apos;s payslip view or PDF when a detailed check is needed.",
    ], styles))
    warning = Table([[Paragraph("<b>Important:</b> Recalculating a draft run replaces its calculated lines. Make employee and salary corrections before approval, then calculate again and recheck the results.", styles["Callout"])]], colWidths=[174 * mm])
    warning.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#FFFBEB")),
        ("BOX", (0, 0), (-1, -1), 0.7, colors.HexColor("#FCD34D")),
        ("LEFTPADDING", (0, 0), (-1, -1), 5 * mm), ("RIGHTPADDING", (0, 0), (-1, -1), 5 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 4 * mm), ("BOTTOMPADDING", (0, 0), (-1, -1), 4 * mm),
    ]))
    story.extend([warning, Paragraph("4. Review, approve, and post", styles["H1"]), numbered_list([
        "Open <b>Review & Approve</b>, select the payroll run, and record any review notes or exceptions.",
        "An authorized approver approves the calculated run for payment.",
        "Before posting, verify that the GL mappings in Settings & Accounting are correct and that the payroll totals match the approved run.",
        "Post the approved run to accounting only when the review is complete.",
    ], styles), Paragraph("After posting, the run is locked and its accounting entries are created. Do not use posting as a way to test figures. If a correction is needed after posting, follow your organization&apos;s approved accounting correction process and use a new period for the next payroll cycle.", styles["Body"]), Paragraph("5. Payments and statutory remittances", styles["H1"]), Paragraph("Payments", styles["H2"]), bullet_list([
        "After approval, open <b>Payments</b> and prepare the payment schedule.",
        "Confirm the employee payment method, date, and reference before marking a payment complete.",
        "Use the exported payment schedule when your bank or mobile-money process requires a file or review list.",
    ], styles), Paragraph("Statutory deductions", styles["H2"]), bullet_list([
        "Open <b>Statutory Deductions</b> for the approved payroll run.",
        "Prepare the PAYE and NSSF remittance records from the calculated payroll figures.",
        "Record the amount and reference after remittance is paid, then keep supporting confirmation with your compliance records.",
    ], styles)])

    story.append(Paragraph("6. Reports, audit, and monthly checklist", styles["H1"]))
    story.append(Paragraph("Use Payroll Reports to review employee, management, compliance, and accounting totals. Use Audit Trail to see who prepared, calculated, approved, paid, or posted a payroll action and when it occurred.", styles["Body"]))
    checklist = [
        ["Check", "Complete"],
        ["Employee list and On payroll status reviewed", ""],
        ["Salary structure and recurring deductions reviewed", ""],
        ["Statutory settings and GL mappings confirmed", ""],
        ["Correct payroll period created", ""],
        ["Calculated lines and payslips reviewed", ""],
        ["Authorized approval recorded", ""],
        ["Payments and statutory remittances recorded", ""],
        ["Reports and audit trail retained", ""],
    ]
    checklist_table = Table([[Paragraph(cell, styles["TableHeader"] if row_index == 0 else styles["Small"]) for cell in row] for row_index, row in enumerate(checklist)], colWidths=[145 * mm, 29 * mm], repeatRows=1)
    checklist_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0F766E")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white), ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#CBD5E1")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 3 * mm), ("RIGHTPADDING", (0, 0), (-1, -1), 3 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 3 * mm), ("BOTTOMPADDING", (0, 0), (-1, -1), 3 * mm),
    ]))
    story.append(checklist_table)
    story.extend([Spacer(1, 5 * mm), Paragraph("Need help?", styles["H2"]), Paragraph("Open the Payroll user guide from the Payroll Overview page in BOAT. Each payroll screen also has a book icon with guidance for that task. For statutory or accounting decisions, confirm the treatment with your authorized accountant or compliance adviser.", styles["Body"])])

    doc.build(story, onFirstPage=footer, onLaterPages=footer)


if __name__ == "__main__":
    main()
