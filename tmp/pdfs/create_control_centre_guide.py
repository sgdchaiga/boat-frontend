from pathlib import Path
from reportlab.lib.colors import HexColor, white
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, KeepTogether
from reportlab.pdfbase.pdfmetrics import stringWidth

ROOT = Path(r"C:\Projects\BOAT")
OUT = ROOT / "output" / "pdf" / "BOAT_Control_Centre_Guide.pdf"
OUT.parent.mkdir(parents=True, exist_ok=True)

NAVY = HexColor("#163A52")
TEAL = HexColor("#0F766E")
SLATE = HexColor("#334155")
MUTED = HexColor("#64748B")
LIGHT = HexColor("#EAF3F5")

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name="TitleCC", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=26, leading=31, textColor=NAVY, spaceAfter=6))
styles.add(ParagraphStyle(name="SubtitleCC", parent=styles["Normal"], fontName="Helvetica", fontSize=11, leading=16, textColor=SLATE, spaceAfter=14))
styles.add(ParagraphStyle(name="H1CC", parent=styles["Heading1"], fontName="Helvetica-Bold", fontSize=15, leading=19, textColor=NAVY, spaceBefore=14, spaceAfter=7))
styles.add(ParagraphStyle(name="H2CC", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=11.5, leading=15, textColor=TEAL, spaceBefore=9, spaceAfter=4))
styles.add(ParagraphStyle(name="BodyCC", parent=styles["BodyText"], fontName="Helvetica", fontSize=9.4, leading=14, textColor=SLATE, spaceAfter=5))
styles.add(ParagraphStyle(name="BulletCC", parent=styles["BodyText"], fontName="Helvetica", fontSize=9.4, leading=13.5, textColor=SLATE, leftIndent=13, firstLineIndent=-8, spaceAfter=3))
styles.add(ParagraphStyle(name="NoteCC", parent=styles["BodyText"], fontName="Helvetica-Bold", fontSize=9.3, leading=13.5, textColor=NAVY, backColor=LIGHT, borderColor=HexColor("#B7D8D5"), borderWidth=0.6, borderPadding=8, spaceBefore=5, spaceAfter=8))
styles.add(ParagraphStyle(name="FooterCC", parent=styles["Normal"], fontName="Helvetica", fontSize=8, textColor=MUTED, alignment=TA_LEFT))

def p(text, style="BodyCC"):
    return Paragraph(text, styles[style])

def bullets(items):
    return [p("- " + item, "BulletCC") for item in items]

def section(title, intro=None, items=None):
    content = [p(title, "H1CC")]
    if intro:
        content.append(p(intro))
    if items:
        content.extend(bullets(items))
    return content

def footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(HexColor("#D7E2E8"))
    canvas.line(doc.leftMargin, 13 * mm, A4[0] - doc.rightMargin, 13 * mm)
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(MUTED)
    canvas.drawString(doc.leftMargin, 8.5 * mm, "BOAT Control Centre Guide | Version 1.0")
    page = f"Page {doc.page}"
    canvas.drawRightString(A4[0] - doc.rightMargin, 8.5 * mm, page)
    canvas.restoreState()

doc = SimpleDocTemplate(
    str(OUT), pagesize=A4, rightMargin=20 * mm, leftMargin=20 * mm,
    topMargin=18 * mm, bottomMargin=20 * mm, title="BOAT Control Centre Guide",
    author="BOAT",
)

story = []
story += [p("BOAT Control Centre", "TitleCC"), p("User and administrator guide", "SubtitleCC")]
story += [p("A shared register for operational, revenue and cash-control issues - from identification through accountable follow-up and resolution.", "NoteCC")]

story += section("1. What the Control Centre does", "The Control Centre brings important control issues into one prioritized queue. It helps teams see financial exposure, record the facts and maintain a consistent audit trail.")
story += section("2. Who uses it", items=[
    "Platform super administrators have exclusive access during the initial rollout and enable the feature for subscription plans.",
    "Organization administrators, managers, internal controllers and other users cannot currently open the Control Centre.",
    "A future page-access release will let platform super administrators and organization administrators grant access to selected users, beginning with organization administrators.",
])
story += section("3. Enable it for an organization", "Control Centre is a feature add-on on a subscription plan. It is not a business type.")
story += [p("1. Sign in as a platform super administrator.", "BulletCC"), p("2. Open <b>Subscription plans</b>.", "BulletCC"), p("3. Find the plan used by the organization, for example the Hotel Professional plan.", "BulletCC"), p("4. Select <b>BOAT Control Centre - Enable for this plan</b>.", "BulletCC"), p("5. Ask affected users to refresh the application or sign out and back in.", "BulletCC")]
story += [p("Enabling the feature applies it to every organization on that plan. Use the organization feature override in the platform database administration workflow when only one organization needs a different setting.", "NoteCC")]

story += section("4. Open the Control Centre", "After the feature is enabled, authorized users see <b>Control Centre</b> in the main navigation. The opening page is <b>Priority exceptions</b>.")
story += section("What the summary cards mean", items=[
    "<b>Critical exceptions</b> - open issues marked critical.",
    "<b>Open exceptions</b> - issues not yet resolved.",
    "<b>Overdue</b> - open issues whose follow-up date has passed.",
    "<b>Value at risk</b> - total potential financial exposure across open issues.",
])
story += [p("Use the <b>Control area</b> filter to focus on an area such as Revenue Assurance or Cash & Treasury. Use <b>Refresh</b> after creating an issue or after scheduled controls have run.", "BodyCC")]

story += section("5. Refer an issue manually", "Use <b>Send to Control Centre</b> whenever an issue needs formal follow-up.")
story += [p("1. Select <b>Send to Control Centre</b>.", "BulletCC"), p("2. Enter a specific title, for example: <i>Room 204 checked out with unpaid balance</i>.", "BulletCC"), p("3. Choose the appropriate control area.", "BulletCC")]
story += section("Control areas", items=[
    "<b>Operations</b> - process, service or operational exception.",
    "<b>Revenue assurance</b> - missing, incorrect or uncollected revenue.",
    "<b>Cash & treasury</b> - cash, bank, till or reconciliation issue.",
    "<b>Stock control</b> - stock loss, variance or movement issue.",
    "<b>User & system controls</b> - access, approval or system-control concern.",
])
story += section("Choose severity", items=[
    "<b>Critical</b> - immediate material exposure, suspected fraud, or urgent customer or regulatory impact.",
    "<b>High</b> - significant issue requiring prompt management attention.",
    "<b>Warning</b> - issue to investigate and correct through normal follow-up.",
    "<b>Low</b> - minor issue or observation.",
])
story += [p("4. Enter the potential value at risk, if known. Use 0 when it cannot yet be estimated.", "BulletCC"), p("5. Record the facts, transaction references, dates and immediate action taken in <b>Reason and comments</b>.", "BulletCC"), p("6. Select <b>Create exception</b>.", "BulletCC")]
story += [p("Use a factual title and include the affected transaction, stay, order or reconciliation where possible. Avoid vague entries such as 'problem' or 'check this.'", "NoteCC")]

story += section("6. Read the priority queue", "Each queue row contains the system reference, title, control area, severity, potential value at risk, detection time and current status. The queue gives priority to critical items, then higher value at risk and earlier detection time.")
story += [p("Resolve the highest-risk issues first. Do not close an issue until the cause, corrective action and supporting evidence have been recorded.", "NoteCC")]

story += section("7. Automated hotel controls", "Scheduled monitoring can add exceptions without a manual referral. The initial hotel control pack checks for:", [
    "A checked-out stay with an outstanding balance.",
    "An occupied automatic-billing stay with no room charge after two hours.",
    "Approved POS voids or refunds that require review.",
    "Reconciliation exceptions that remain unresolved for more than seven days.",
])
story += [p("A clear queue means that no exception matched the implemented checks at that time. It does not prove every process is correct.", "NoteCC")]

story += [KeepTogether(section("8. Good control practice", items=[
    "Review critical and overdue exceptions at least daily.",
    "Use the original transaction, stay, POS order or reconciliation record as evidence.",
    "Record facts separately from assumptions.",
    "Assign a clear owner and due date when your organization's workflow is available.",
    "Escalate suspected fraud, data exposure or material cash loss immediately under your organization's incident process.",
    "Do not share accounts or credentials; the audit trail depends on individual use.",
]))]

story += section("9. Troubleshooting")
story += section("The Control Centre menu is missing", items=[
    "Confirm the organization has an active or trial subscription.",
    "Confirm the organization's plan has BOAT Control Centre enabled in Subscription plans.",
    "Confirm the user is a platform super administrator. Other roles are intentionally excluded during the initial rollout.",
    "Refresh the session by signing out and back in.",
])
story += section("The page cannot load", "Confirm the Control Centre database migrations have been applied and the user belongs to the active organization. If the issue continues, provide the displayed error message to the platform administrator.")
story += section("No automated exceptions appear", "Check that scheduled monitoring is active, relevant hotel data exists and the issue meets a current control rule. Manual referrals remain available while monitoring is investigated.")
story += [Spacer(1, 8), p("Audience: Platform super administrators (initial rollout)", "FooterCC")]

doc.build(story, onFirstPage=footer, onLaterPages=footer)
print(OUT)
