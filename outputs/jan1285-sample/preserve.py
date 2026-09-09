import zipfile,xml.etree.ElementTree as E,json,copy
from pathlib import Path
p=Path(__file__).parent
src=Path(r'C:\Users\LUBS\Documents\Boat\Spensa\Work 2026 expenditure.xlsx')
ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
changes=json.loads((p/'changes.json').read_text())
with zipfile.ZipFile(src) as z:
    root=E.fromstring(z.read('xl/worksheets/sheet1.xml'))
    row=root.find("m:sheetData/m:row[@r='2']",ns)
    styles=E.fromstring(z.read('xl/styles.xml'))
    xfs=styles.find('m:cellXfs',ns)
    row.set('ht','115');row.set('customHeight','1')
    for col,value in zip('FGHIJKLMNOPQR',changes):
        c=row.find(f"m:c[@r='{col}2']",ns)
        xf=copy.deepcopy(xfs[int(c.get('s','0'))])
        alignment=xf.find('m:alignment',ns)
        if alignment is None: alignment=E.SubElement(xf,'{'+ns['m']+'}alignment')
        alignment.set('wrapText','1');xf.set('applyAlignment','1')
        c.set('s',str(len(xfs)));xfs.append(xf)
        for child in list(c):c.remove(child)
        c.set('t','inlineStr')
        E.SubElement(E.SubElement(c,'{'+ns['m']+'}is'),'{'+ns['m']+'}t').text=value
    dest=p/'Work 2026 expenditure - January 1285 votes.xlsx'
    xfs.set('count',str(len(xfs)))
    with zipfile.ZipFile(dest,'w',zipfile.ZIP_DEFLATED) as out:
        for info in z.infolist():out.writestr(copy.copy(info),E.tostring(root,encoding='utf-8',xml_declaration=True) if info.filename=='xl/worksheets/sheet1.xml' else E.tostring(styles,encoding='utf-8',xml_declaration=True) if info.filename=='xl/styles.xml' else z.read(info.filename))
    with zipfile.ZipFile(dest) as out:
        assert all(out.read(n)==z.read(n) for n in z.namelist() if n not in ['xl/worksheets/sheet1.xml','xl/styles.xml'])
import openpyxl
a=openpyxl.load_workbook(src);b=openpyxl.load_workbook(dest)
diff=[]
for sa,sb in zip(a,b):
    for row in sa:
        for c in row:
            if c.value!=sb[c.coordinate].value:diff.append((sa.title,c.coordinate))
assert diff==[('JAN 1285',c+'2') for c in 'FGHIJKLMNOPQR'],diff
assert all(b['JAN 1285'][c+'2'].alignment.wrap_text for c in 'FGHIJKLMNOPQR')
print('Verified: only 13 January header values and header row height changed. All other ZIP parts identical.')
