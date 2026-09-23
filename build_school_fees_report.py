from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

OUT = r"C:\Projects\BOAT\School Fees Performance Report.docx"

NAVY = "17365D"
BLUE = "DCE6F1"
PALE = "F5F8FC"
GRAY = "D9D9D9"

def shade(cell, fill):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:fill'), fill)
    tcPr.append(shd)

def borders(cell, color=GRAY):
    tcPr = cell._tc.get_or_add_tcPr()
    tcBorders = tcPr.first_child_found_in('w:tcBorders')
    if tcBorders is None:
        tcBorders = OxmlElement('w:tcBorders')
        tcPr.append(tcBorders)
    for edge in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'):
        tag = 'w:' + edge
        element = tcBorders.find(qn(tag))
        if element is None:
            element = OxmlElement(tag)
            tcBorders.append(element)
        element.set(qn('w:val'), 'single')
        element.set(qn('w:sz'), '6')
        element.set(qn('w:color'), color)

def margin(cell, top=100, start=120, bottom=100, end=120):
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    mar = tcPr.first_child_found_in('w:tcMar')
    if mar is None:
        mar = OxmlElement('w:tcMar')
        tcPr.append(mar)
    for side, val in [('top',top),('start',start),('bottom',bottom),('end',end)]:
        el = mar.find(qn('w:' + side))
        if el is None:
            el = OxmlElement('w:' + side)
            mar.append(el)
        el.set(qn('w:w'), str(val)); el.set(qn('w:type'), 'dxa')

def set_repeat_table_header(row):
    trPr = row._tr.get_or_add_trPr()
    el = OxmlElement('w:tblHeader'); el.set(qn('w:val'), 'true'); trPr.append(el)

def set_cell_text(cell, text, bold=False, color=None, size=9):
    cell.text = ''
    p = cell.paragraphs[0]
    p.paragraph_format.space_after = Pt(0)
    p.paragraph_format.space_before = Pt(0)
    r = p.add_run(text)
    r.bold = bold; r.font.size = Pt(size); r.font.name = 'Aptos'
    r._element.rPr.rFonts.set(qn('w:ascii'), 'Aptos')
    r._element.rPr.rFonts.set(qn('w:hAnsi'), 'Aptos')
    if color: r.font.color.rgb = RGBColor.from_string(color)
    cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
    margin(cell); borders(cell)
    return p

def add_table(doc, headers, rows, widths=None):
    tbl = doc.add_table(rows=1, cols=len(headers))
    tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    tbl.autofit = False
    hdr = tbl.rows[0]
    set_repeat_table_header(hdr)
    for i, h in enumerate(headers):
        set_cell_text(hdr.cells[i], h, bold=True, color='FFFFFF')
        shade(hdr.cells[i], NAVY)
        if widths: hdr.cells[i].width = Inches(widths[i])
    for n, row in enumerate(rows):
        cells = tbl.add_row().cells
        for i, value in enumerate(row):
            p = set_cell_text(cells[i], value)
            if widths: cells[i].width = Inches(widths[i])
            if n % 2 == 1: shade(cells[i], PALE)
    doc.add_paragraph().paragraph_format.space_after = Pt(1)
    return tbl

def bullet(doc, text, level=0):
    p = doc.add_paragraph(style='List Bullet' if level == 0 else 'List Bullet 2')
    p.paragraph_format.space_after = Pt(3)
    p.add_run(text)
    return p

doc = Document()
sec = doc.sections[0]
sec.top_margin = Inches(.72); sec.bottom_margin = Inches(.7)
sec.left_margin = Inches(.78); sec.right_margin = Inches(.78)

styles = doc.styles
styles['Normal'].font.name = 'Aptos'; styles['Normal'].font.size = Pt(10)
styles['Normal']._element.rPr.rFonts.set(qn('w:ascii'), 'Aptos')
styles['Normal']._element.rPr.rFonts.set(qn('w:hAnsi'), 'Aptos')
styles['Normal'].paragraph_format.space_after = Pt(6)
for name, size in [('Title', 22), ('Heading 1', 14), ('Heading 2', 11)]:
    st = styles[name]; st.font.name = 'Aptos Display' if name == 'Title' else 'Aptos'
    st.font.size = Pt(size); st.font.bold = True; st.font.color.rgb = RGBColor(0,0,0)
    st._element.rPr.rFonts.set(qn('w:ascii'), st.font.name)
    st._element.rPr.rFonts.set(qn('w:hAnsi'), st.font.name)
    st.paragraph_format.space_before = Pt(14 if name != 'Title' else 0)
    st.paragraph_format.space_after = Pt(6)

title = doc.add_paragraph(style='Title'); title.alignment = WD_ALIGN_PARAGRAPH.LEFT
title.add_run('School Fees Performance Report')
sub = doc.add_paragraph(); sub.paragraph_format.space_after = Pt(14)
r = sub.add_run('Management reporting specification for BOAT Finance and Operations')
r.italic = True; r.font.size = Pt(11); r.font.color.rgb = RGBColor.from_string('555555')

doc.add_heading('Purpose and management view', level=1)
doc.add_paragraph('The School Fees Performance Report gives school management a clear view of fee billing, collections, outstanding balances, collection performance, trends and arrears. It should make exceptions visible early enough for action during the term.')
doc.add_paragraph('The report must enable management to answer: how much should have been collected, how much has been collected, what remains outstanding, which classes or fee types are underperforming, who owes money, and whether collection performance is improving or deteriorating.')

doc.add_heading('Report location and layout', level=1)
doc.add_paragraph('Add the report under Reports > Operations / Fees > Fees Performance. Arrange the page in the following order so that the highest-level decision information appears first:')
for x in ['Top: KPI cards.', 'Middle: Collection Trend versus Target and Payment Channel summary.', 'Below: Performance by Class.', 'Then: Fee Type Performance and Arrears Analysis.', 'Bottom: Detailed Student Payment Status.']:
    bullet(doc, x)

doc.add_heading('Key performance indicators', level=1)
doc.add_paragraph('Display the following KPI cards for the selected filters. The collection-rate calculation is Total Fees Collected / Total Fees Billed x 100.')
add_table(doc, ['KPI', 'Definition or purpose'], [
    ('Total Students', 'Students included by the selected filters.'),
    ('Total Fees Billed', 'Total fee amount billed for included students.'),
    ('Total Fees Collected', 'Total collection amount received.'),
    ('Collection Rate', 'Total Fees Collected divided by Total Fees Billed, expressed as a percentage.'),
    ('Outstanding Fees', 'Unpaid balance remaining on billed fees.'),
    ('Fully Paid Students', 'Students whose billed fees are fully settled.'),
    ('Partially Paid Students', 'Students with a payment and an outstanding balance.'),
    ('Students With No Payment', 'Students with no payment recorded.')
], [2.05, 4.75])

doc.add_heading('Collection performance by class', level=1)
doc.add_paragraph('Provide a class-level table with clickable rows that drill down from class to stream and then to individual students.')
add_table(doc, ['Class', 'Students', 'Fees Billed', 'Fees Collected', 'Outstanding', 'Collection Percent'], [
    ('Class', 'Number of students', 'Amount', 'Amount', 'Amount', 'Percent')
], [1.0, .85, 1.12, 1.22, 1.1, 1.2])

doc.add_heading('Collection trend versus target', level=1)
doc.add_paragraph('Show actual cumulative collections alongside expected or target cumulative collections. Support comparison by week or month throughout the term, and display expected collection percentage, actual collection percentage, and variance in percentage points.')

doc.add_heading('Performance by fee type', level=1)
doc.add_paragraph('Show billing and collection results by fee type. Applicable examples include Tuition, Boarding, Meals, Development, Examination and Other Charges.')
add_table(doc, ['Fee Type', 'Amount Billed', 'Amount Collected', 'Outstanding', 'Collection Percent'], [
    ('Fee type', 'Amount', 'Amount', 'Amount', 'Percent')
], [1.55, 1.3, 1.4, 1.25, 1.25])

doc.add_heading('Arrears analysis', level=1)
doc.add_paragraph('Group outstanding balances into configurable arrears bands. For each band, show the number of students, outstanding amount and percentage of total arrears.')
add_table(doc, ['Illustrative arrears band', 'Students', 'Outstanding Amount', 'Percent of Total Arrears'], [
    ('Below UGX 100,000', 'Count', 'Amount', 'Percent'),
    ('UGX 100,001 to 500,000', 'Count', 'Amount', 'Percent'),
    ('UGX 500,001 to 1,000,000', 'Count', 'Amount', 'Percent'),
    ('Above UGX 1,000,000', 'Count', 'Amount', 'Percent')
], [2.35, .85, 1.65, 1.85])

doc.add_heading('Collection by payment channel', level=1)
doc.add_paragraph('Summarize collections from SchoolPay, Bank, Mobile Money, Cash and Other channels. For each channel, show Collected, Matched, Unmatched and Reconciled values. This view must integrate with BOAT Finance, Treasury and reconciliation data.')
add_table(doc, ['Payment Channel', 'Collected', 'Matched', 'Unmatched', 'Reconciled'], [
    ('SchoolPay, Bank, Mobile Money, Cash or Other', 'Amount', 'Amount', 'Amount', 'Amount')
], [2.1, 1.2, 1.15, 1.25, 1.2])

doc.add_heading('Student payment status', level=1)
doc.add_paragraph('Provide a detailed drill-down table at student level. Payment Status values are Fully Paid, Partial, Low Payment and No Payment.')
add_table(doc, ['Student', 'Student Number', 'Class', 'Stream', 'Total Fees', 'Amount Paid', 'Balance', 'Percent Paid', 'Payment Status'], [
    ('Student name', 'Identifier', 'Class', 'Stream', 'Amount', 'Amount', 'Amount', 'Percent', 'Status')
], [1.0, .86, .52, .57, .72, .78, .7, .72, .9])

doc.add_heading('Comparative performance', level=1)
doc.add_paragraph('Compare results with the equivalent elapsed point in the previous term or year. Do not compare a partially completed term with a completed term.')
add_table(doc, ['Measure', 'Current Period', 'Comparative Period', 'Change'], [
    ('Collection Rate', 'Percent', 'Percent', 'Percentage points'),
    ('Amount Collected', 'UGX', 'UGX', 'UGX'),
    ('Outstanding Fees', 'UGX', 'UGX', 'UGX')
], [2.0, 1.45, 1.55, 1.3])

doc.add_heading('Filters and exports', level=1)
doc.add_paragraph('All KPI cards, charts and tables must respond to the selected filters.')
add_table(doc, ['Filter', 'Available selections'], [
    ('Academic period', 'Academic Year, Term and As at Date'),
    ('Student grouping', 'Class, Stream and Day or Boarding'),
    ('Financial detail', 'Fee Type and Payment Channel'),
    ('Collection condition', 'Payment Status')
], [2.0, 4.3])
doc.add_paragraph('Support Print, PDF and Excel export for the report.', style=None)

footer = sec.footer.paragraphs[0]
footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
fr = footer.add_run('School Fees Performance Report')
fr.font.name = 'Aptos'; fr.font.size = Pt(8); fr.font.color.rgb = RGBColor.from_string('666666')

doc.core_properties.title = 'School Fees Performance Report'
doc.core_properties.subject = 'Management reporting specification'
doc.core_properties.author = 'BOAT'
doc.save(OUT)
print(OUT)
