import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Member, Loan, FixedDeposit, CashbookEntry, LedgerAccount } from "@/types/saccoPdf";

const PRIMARY_COLOR: [number, number, number] = [16, 185, 129]; // emerald-500
const DARK_COLOR: [number, number, number] = [15, 23, 42]; // slate-900
const GRAY_COLOR: [number, number, number] = [100, 116, 139]; // slate-500
const LIGHT_BG: [number, number, number] = [248, 250, 252]; // slate-50

const fmtCurrency = (n: number) => 'UGX ' + n.toLocaleString('en-UG', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

function addHeader(doc: jsPDF, title: string, subtitle: string, dateRange: string) {
  const pageWidth = doc.internal.pageSize.getWidth();

  // Green header bar
  doc.setFillColor(...PRIMARY_COLOR);
  doc.rect(0, 0, pageWidth, 32, 'F');

  // Logo circle
  doc.setFillColor(255, 255, 255);
  doc.circle(20, 16, 8, 'F');
  doc.setFillColor(...PRIMARY_COLOR);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...PRIMARY_COLOR);
  doc.text('SP', 16.5, 18.5);

  // Company name
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('SACCOPro', 32, 14);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.text('Financial Management System', 32, 20);

  // Date on right
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text(`Generated: ${new Date().toLocaleDateString('en-UG', { year: 'numeric', month: 'long', day: 'numeric' })}`, pageWidth - 14, 14, { align: 'right' });
  doc.text(`Time: ${new Date().toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit' })}`, pageWidth - 14, 20, { align: 'right' });

  // Report title
  doc.setTextColor(...DARK_COLOR);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(title, 14, 44);

  // Subtitle
  doc.setTextColor(...GRAY_COLOR);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(subtitle, 14, 50);

  // Date range
  doc.setFontSize(8);
  doc.text(`Period: ${dateRange}`, 14, 56);

  // Separator line
  doc.setDrawColor(...PRIMARY_COLOR);
  doc.setLineWidth(0.5);
  doc.line(14, 60, pageWidth - 14, 60);

  return 65; // starting Y position for content
}

function addFooter(doc: jsPDF) {
  const pageCount = doc.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.line(14, pageHeight - 18, pageWidth - 14, pageHeight - 18);
    doc.setFontSize(7);
    doc.setTextColor(...GRAY_COLOR);
    doc.text('SACCOPro - Confidential Financial Report', 14, pageHeight - 12);
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - 14, pageHeight - 12, { align: 'right' });
  }
}

function addSummaryBox(doc: jsPDF, startY: number, items: { label: string; value: string }[]) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const boxWidth = (pageWidth - 28 - (items.length - 1) * 4) / items.length;

  items.forEach((item, i) => {
    const x = 14 + i * (boxWidth + 4);
    doc.setFillColor(...LIGHT_BG);
    doc.roundedRect(x, startY, boxWidth, 22, 2, 2, 'F');
    doc.setFontSize(7);
    doc.setTextColor(...GRAY_COLOR);
    doc.setFont('helvetica', 'normal');
    doc.text(item.label, x + 4, startY + 8);
    doc.setFontSize(10);
    doc.setTextColor(...DARK_COLOR);
    doc.setFont('helvetica', 'bold');
    doc.text(item.value, x + 4, startY + 17);
  });

  return startY + 28;
}

// ===== REPORT GENERATORS =====

export function generateIncomeStatement(
  ledgerAccounts: LedgerAccount[],
  dateFrom: string,
  dateTo: string
) {
  const doc = new jsPDF();
  let y = addHeader(doc, 'Income Statement', 'Monthly Financial Statement - Revenue & Expenses', `${dateFrom} to ${dateTo}`);

  const incomeAccounts = ledgerAccounts.filter(a => a.type === 'Income');
  const expenseAccounts = ledgerAccounts.filter(a => a.type === 'Expense');
  const totalIncome = incomeAccounts.reduce((s, a) => s + a.balance, 0);
  const totalExpenses = expenseAccounts.reduce((s, a) => s + a.balance, 0);
  const netIncome = totalIncome - totalExpenses;

  y = addSummaryBox(doc, y, [
    { label: 'Total Revenue', value: fmtCurrency(totalIncome) },
    { label: 'Total Expenses', value: fmtCurrency(totalExpenses) },
    { label: 'Net Income', value: fmtCurrency(netIncome) },
    { label: 'Profit Margin', value: totalIncome > 0 ? `${((netIncome / totalIncome) * 100).toFixed(1)}%` : '0%' },
  ]);

  // Revenue section
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...DARK_COLOR);
  doc.text('REVENUE', 14, y + 4);
  y += 8;

  autoTable(doc, {
    startY: y,
    head: [['Account Code', 'Account Name', 'Category', 'Amount (UGX)']],
    body: [
      ...incomeAccounts.map(a => [a.code, a.name, a.category, fmtCurrency(a.balance)]),
      ['', '', { content: 'Total Revenue', styles: { fontStyle: 'bold' } }, { content: fmtCurrency(totalIncome), styles: { fontStyle: 'bold' } }],
    ],
    theme: 'grid',
    headStyles: { fillColor: PRIMARY_COLOR, fontSize: 8, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 14, right: 14 },
  });

  y = (doc as any).lastAutoTable.finalY + 10;

  // Expenses section
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...DARK_COLOR);
  doc.text('EXPENSES', 14, y);
  y += 4;

  autoTable(doc, {
    startY: y,
    head: [['Account Code', 'Account Name', 'Category', 'Amount (UGX)']],
    body: [
      ...expenseAccounts.map(a => [a.code, a.name, a.category, fmtCurrency(a.balance)]),
      ['', '', { content: 'Total Expenses', styles: { fontStyle: 'bold' } }, { content: fmtCurrency(totalExpenses), styles: { fontStyle: 'bold' } }],
    ],
    theme: 'grid',
    headStyles: { fillColor: [239, 68, 68], fontSize: 8, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: [254, 242, 242] },
    margin: { left: 14, right: 14 },
  });

  y = (doc as any).lastAutoTable.finalY + 10;

  // Net Income
  doc.setFillColor(netIncome >= 0 ? 236 : 254, netIncome >= 0 ? 253 : 226, netIncome >= 0 ? 245 : 226);
  doc.roundedRect(14, y, doc.internal.pageSize.getWidth() - 28, 16, 2, 2, 'F');
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(netIncome >= 0 ? 5 : 185, netIncome >= 0 ? 150 : 28, netIncome >= 0 ? 105 : 28);
  doc.text(`NET INCOME: ${fmtCurrency(netIncome)}`, 20, y + 10);

  addFooter(doc);
  doc.save(`SACCOPro_Income_Statement_${dateFrom}_to_${dateTo}.pdf`);
}

export function generateBalanceSheet(
  ledgerAccounts: LedgerAccount[],
  _dateFrom: string,
  dateTo: string
) {
  const doc = new jsPDF();
  let y = addHeader(doc, 'Balance Sheet', 'Statement of Financial Position', `As at ${dateTo}`);

  const assets = ledgerAccounts.filter(a => a.type === 'Asset');
  const liabilities = ledgerAccounts.filter(a => a.type === 'Liability');
  const equity = ledgerAccounts.filter(a => a.type === 'Equity');
  const totalAssets = assets.reduce((s, a) => s + a.balance, 0);
  const totalLiabilities = liabilities.reduce((s, a) => s + a.balance, 0);
  const totalEquity = equity.reduce((s, a) => s + a.balance, 0);

  y = addSummaryBox(doc, y, [
    { label: 'Total Assets', value: fmtCurrency(totalAssets) },
    { label: 'Total Liabilities', value: fmtCurrency(totalLiabilities) },
    { label: 'Total Equity', value: fmtCurrency(totalEquity) },
  ]);

  // Assets
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...DARK_COLOR);
  doc.text('ASSETS', 14, y + 4);
  y += 8;

  const currentAssets = assets.filter(a => a.category === 'Current Assets');
  const fixedAssets = assets.filter(a => a.category === 'Fixed Assets');

  autoTable(doc, {
    startY: y,
    head: [['Code', 'Account Name', 'Category', 'Balance (UGX)']],
    body: [
      ...currentAssets.map(a => [a.code, a.name, 'Current', fmtCurrency(a.balance)]),
      ['', '', { content: 'Subtotal Current Assets', styles: { fontStyle: 'bold', fontSize: 7 } }, { content: fmtCurrency(currentAssets.reduce((s, a) => s + a.balance, 0)), styles: { fontStyle: 'bold' } }],
      ...fixedAssets.map(a => [a.code, a.name, 'Fixed', fmtCurrency(a.balance)]),
      ['', '', { content: 'Subtotal Fixed Assets', styles: { fontStyle: 'bold', fontSize: 7 } }, { content: fmtCurrency(fixedAssets.reduce((s, a) => s + a.balance, 0)), styles: { fontStyle: 'bold' } }],
      ['', '', { content: 'TOTAL ASSETS', styles: { fontStyle: 'bold' } }, { content: fmtCurrency(totalAssets), styles: { fontStyle: 'bold' } }],
    ],
    theme: 'grid',
    headStyles: { fillColor: [59, 130, 246], fontSize: 8, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: [239, 246, 255] },
    margin: { left: 14, right: 14 },
  });

  y = (doc as any).lastAutoTable.finalY + 10;

  // Liabilities & Equity
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...DARK_COLOR);
  doc.text('LIABILITIES & EQUITY', 14, y);
  y += 4;

  autoTable(doc, {
    startY: y,
    head: [['Code', 'Account Name', 'Type', 'Balance (UGX)']],
    body: [
      ...liabilities.map(a => [a.code, a.name, 'Liability', fmtCurrency(a.balance)]),
      ['', '', { content: 'Total Liabilities', styles: { fontStyle: 'bold', fontSize: 7 } }, { content: fmtCurrency(totalLiabilities), styles: { fontStyle: 'bold' } }],
      ...equity.map(a => [a.code, a.name, 'Equity', fmtCurrency(a.balance)]),
      ['', '', { content: 'Total Equity', styles: { fontStyle: 'bold', fontSize: 7 } }, { content: fmtCurrency(totalEquity), styles: { fontStyle: 'bold' } }],
      ['', '', { content: 'TOTAL LIABILITIES & EQUITY', styles: { fontStyle: 'bold' } }, { content: fmtCurrency(totalLiabilities + totalEquity), styles: { fontStyle: 'bold' } }],
    ],
    theme: 'grid',
    headStyles: { fillColor: [139, 92, 246], fontSize: 8, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: [245, 243, 255] },
    margin: { left: 14, right: 14 },
  });

  addFooter(doc);
  doc.save(`SACCOPro_Balance_Sheet_${dateTo}.pdf`);
}

export function generateLoanPortfolioReport(
  loans: Loan[],
  dateFrom: string,
  dateTo: string
) {
  const doc = new jsPDF('landscape');
  let y = addHeader(doc, 'Loan Portfolio Summary', 'Comprehensive Loan Performance Report', `${dateFrom} to ${dateTo}`);

  const activeLoans = loans.filter((l) => l.status === "disbursed");
  const totalDisbursed = activeLoans.reduce((s, l) => s + l.amount, 0);
  const totalOutstanding = activeLoans.reduce((s, l) => s + l.balance, 0);
  const totalRepaid = activeLoans.reduce((s, l) => s + l.paidAmount, 0);
  const avgInterestRate = loans.length > 0 ? loans.reduce((s, l) => s + l.interestRate, 0) / loans.length : 0;

  y = addSummaryBox(doc, y, [
    { label: 'Total Loans', value: loans.length.toString() },
    { label: 'Active Loans', value: activeLoans.length.toString() },
    { label: 'Total Disbursed', value: fmtCurrency(totalDisbursed) },
    { label: 'Outstanding Balance', value: fmtCurrency(totalOutstanding) },
    { label: 'Total Repaid', value: fmtCurrency(totalRepaid) },
    { label: 'Avg Interest Rate', value: `${avgInterestRate.toFixed(1)}%` },
  ]);

  // Loan by type summary
  const loanTypes = [...new Set(loans.map(l => l.loanType))];
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...DARK_COLOR);
  doc.text('LOAN DISTRIBUTION BY TYPE', 14, y + 4);
  y += 8;

  autoTable(doc, {
    startY: y,
    head: [['Loan Type', 'Count', 'Total Amount', 'Outstanding', 'Repaid', 'Avg Rate']],
    body: loanTypes.map(type => {
      const typeLoans = loans.filter(l => l.loanType === type);
      return [
        type,
        typeLoans.length.toString(),
        fmtCurrency(typeLoans.reduce((s, l) => s + l.amount, 0)),
        fmtCurrency(typeLoans.reduce((s, l) => s + l.balance, 0)),
        fmtCurrency(typeLoans.reduce((s, l) => s + l.paidAmount, 0)),
        `${(typeLoans.reduce((s, l) => s + l.interestRate, 0) / typeLoans.length).toFixed(1)}%`,
      ];
    }),
    theme: 'grid',
    headStyles: { fillColor: PRIMARY_COLOR, fontSize: 8, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: LIGHT_BG },
    margin: { left: 14, right: 14 },
  });

  y = (doc as any).lastAutoTable.finalY + 10;

  // Full loan list
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...DARK_COLOR);
  doc.text('DETAILED LOAN PORTFOLIO', 14, y);
  y += 4;

  autoTable(doc, {
    startY: y,
    head: [['Loan ID', 'Member', 'Type', 'Amount', 'Rate', 'Term', 'Monthly Pmt', 'Balance', 'Paid', 'Status']],
    body: loans.map(l => [
      l.id,
      l.memberName,
      l.loanType,
      fmtCurrency(l.amount),
      `${l.interestRate}%`,
      `${l.term} mo`,
      fmtCurrency(l.monthlyPayment),
      fmtCurrency(l.balance),
      fmtCurrency(l.paidAmount),
      l.status.toUpperCase(),
    ]),
    theme: 'grid',
    headStyles: { fillColor: [59, 130, 246], fontSize: 7, fontStyle: 'bold' },
    bodyStyles: { fontSize: 7 },
    alternateRowStyles: { fillColor: [239, 246, 255] },
    margin: { left: 14, right: 14 },
    didParseCell: (data) => {
      if (data.column.index === 9 && data.section === 'body') {
        const val = String(data.cell.raw);
        if (val === 'DISBURSED') data.cell.styles.textColor = [16, 185, 129];
        else if (val === 'PENDING') data.cell.styles.textColor = [245, 158, 11];
        else if (val === 'REJECTED') data.cell.styles.textColor = [239, 68, 68];
        else if (val === 'CLOSED') data.cell.styles.textColor = [100, 116, 139];
        else if (val === 'APPROVED') data.cell.styles.textColor = [59, 130, 246];
        data.cell.styles.fontStyle = 'bold';
      }
    },
  });

  addFooter(doc);
  doc.save(`SACCOPro_Loan_Portfolio_${dateFrom}_to_${dateTo}.pdf`);
}

export function generateMemberSavingsReport(
  members: Member[],
  dateFrom: string,
  dateTo: string
) {
  const doc = new jsPDF();
  let y = addHeader(doc, 'Member Savings Statement', 'Individual & Aggregate Savings Report', `${dateFrom} to ${dateTo}`);

  const activeMembers = members.filter(m => m.status === 'active');
  const totalSavings = members.reduce((s, m) => s + m.savingsBalance, 0);
  const totalShares = members.reduce((s, m) => s + m.sharesBalance, 0);
  const avgSavings = activeMembers.length > 0 ? totalSavings / activeMembers.length : 0;

  y = addSummaryBox(doc, y, [
    { label: 'Total Members', value: members.length.toString() },
    { label: 'Active Members', value: activeMembers.length.toString() },
    { label: 'Total Savings', value: fmtCurrency(totalSavings) },
    { label: 'Total Shares', value: fmtCurrency(totalShares) },
  ]);

  y = addSummaryBox(doc, y, [
    { label: 'Avg Savings/Member', value: fmtCurrency(Math.round(avgSavings)) },
    { label: 'Combined Balance', value: fmtCurrency(totalSavings + totalShares) },
  ]);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...DARK_COLOR);
  doc.text('MEMBER SAVINGS DETAILS', 14, y + 4);
  y += 8;

  autoTable(doc, {
    startY: y,
    head: [['Account No.', 'Member Name', 'Gender', 'Join Date', 'Savings (UGX)', 'Shares (UGX)', 'Total (UGX)', 'Status']],
    body: [
      ...members.map(m => [
        m.accountNumber,
        m.name,
        m.gender,
        m.joinDate,
        fmtCurrency(m.savingsBalance),
        fmtCurrency(m.sharesBalance),
        fmtCurrency(m.savingsBalance + m.sharesBalance),
        m.status.toUpperCase(),
      ]),
      ['', { content: 'TOTALS', styles: { fontStyle: 'bold' } }, '', '', { content: fmtCurrency(totalSavings), styles: { fontStyle: 'bold' } }, { content: fmtCurrency(totalShares), styles: { fontStyle: 'bold' } }, { content: fmtCurrency(totalSavings + totalShares), styles: { fontStyle: 'bold' } }, ''],
    ],
    theme: 'grid',
    headStyles: { fillColor: PRIMARY_COLOR, fontSize: 7, fontStyle: 'bold' },
    bodyStyles: { fontSize: 7 },
    alternateRowStyles: { fillColor: LIGHT_BG },
    margin: { left: 14, right: 14 },
    didParseCell: (data) => {
      if (data.column.index === 7 && data.section === 'body') {
        const val = String(data.cell.raw);
        if (val === 'ACTIVE') data.cell.styles.textColor = [16, 185, 129];
        else if (val === 'INACTIVE') data.cell.styles.textColor = [239, 68, 68];
        else if (val === 'PENDING') data.cell.styles.textColor = [245, 158, 11];
        data.cell.styles.fontStyle = 'bold';
      }
    },
  });

  addFooter(doc);
  doc.save(`SACCOPro_Member_Savings_${dateFrom}_to_${dateTo}.pdf`);
}

export function generateFixedDepositReport(
  fixedDeposits: FixedDeposit[],
  dateFrom: string,
  dateTo: string
) {
  const doc = new jsPDF('landscape');
  let y = addHeader(doc, 'Fixed Deposit Maturity Schedule', 'Deposit Tracking & Interest Accrual Report', `${dateFrom} to ${dateTo}`);

  const activeFDs = fixedDeposits.filter(f => f.status === 'active');
  const maturedFDs = fixedDeposits.filter(f => f.status === 'matured');
  const totalDeposited = fixedDeposits.reduce((s, f) => s + f.amount, 0);
  const totalInterest = fixedDeposits.reduce((s, f) => s + f.interestEarned, 0);
  const avgRate = fixedDeposits.length > 0 ? fixedDeposits.reduce((s, f) => s + f.interestRate, 0) / fixedDeposits.length : 0;

  y = addSummaryBox(doc, y, [
    { label: 'Total Deposits', value: fixedDeposits.length.toString() },
    { label: 'Active Deposits', value: activeFDs.length.toString() },
    { label: 'Matured', value: maturedFDs.length.toString() },
    { label: 'Total Deposited', value: fmtCurrency(totalDeposited) },
    { label: 'Interest Earned', value: fmtCurrency(totalInterest) },
    { label: 'Avg Rate', value: `${avgRate.toFixed(1)}%` },
  ]);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...DARK_COLOR);
  doc.text('FIXED DEPOSIT MATURITY SCHEDULE', 14, y + 4);
  y += 8;

  autoTable(doc, {
    startY: y,
    head: [['FD ID', 'Member', 'Amount (UGX)', 'Rate (%)', 'Term (Mo)', 'Start Date', 'Maturity Date', 'Interest Earned', 'Auto Renew', 'Status', 'Days to Maturity']],
    body: fixedDeposits.map(fd => {
      const matDate = new Date(fd.maturityDate);
      const today = new Date();
      const daysToMat = Math.ceil((matDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      return [
        fd.id,
        fd.memberName,
        fmtCurrency(fd.amount),
        fd.interestRate.toFixed(1),
        fd.term.toString(),
        fd.startDate,
        fd.maturityDate,
        fmtCurrency(fd.interestEarned),
        fd.autoRenew ? 'Yes' : 'No',
        fd.status.toUpperCase(),
        daysToMat > 0 ? `${daysToMat} days` : 'Matured',
      ];
    }),
    theme: 'grid',
    headStyles: { fillColor: [6, 182, 212], fontSize: 7, fontStyle: 'bold' },
    bodyStyles: { fontSize: 7 },
    alternateRowStyles: { fillColor: [236, 254, 255] },
    margin: { left: 14, right: 14 },
    didParseCell: (data) => {
      if (data.column.index === 9 && data.section === 'body') {
        const val = String(data.cell.raw);
        if (val === 'ACTIVE') data.cell.styles.textColor = [16, 185, 129];
        else if (val === 'MATURED') data.cell.styles.textColor = [245, 158, 11];
        else if (val === 'WITHDRAWN') data.cell.styles.textColor = [239, 68, 68];
        data.cell.styles.fontStyle = 'bold';
      }
    },
  });

  addFooter(doc);
  doc.save(`SACCOPro_Fixed_Deposits_${dateFrom}_to_${dateTo}.pdf`);
}

export function generateCashbookReport(
  cashbook: CashbookEntry[],
  dateFrom: string,
  dateTo: string
) {
  const doc = new jsPDF('landscape');
  let y = addHeader(doc, 'Cashbook Summary', 'Daily Cash Transactions Report', `${dateFrom} to ${dateTo}`);

  const filtered = cashbook.filter(e => e.date >= dateFrom && e.date <= dateTo);
  const totalDebits = filtered.reduce((s, e) => s + e.debit, 0);
  const totalCredits = filtered.reduce((s, e) => s + e.credit, 0);
  const netCash = totalDebits - totalCredits;
  const closingBalance = filtered.length > 0 ? filtered[filtered.length - 1].balance : 0;

  y = addSummaryBox(doc, y, [
    { label: 'Total Entries', value: filtered.length.toString() },
    { label: 'Total Receipts', value: fmtCurrency(totalDebits) },
    { label: 'Total Payments', value: fmtCurrency(totalCredits) },
    { label: 'Net Cash Flow', value: fmtCurrency(netCash) },
    { label: 'Closing Balance', value: fmtCurrency(closingBalance) },
  ]);

  // Category summary
  const categories = [...new Set(filtered.map(e => e.category))];
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...DARK_COLOR);
  doc.text('SUMMARY BY CATEGORY', 14, y + 4);
  y += 8;

  autoTable(doc, {
    startY: y,
    head: [['Category', 'Entries', 'Total Debits (UGX)', 'Total Credits (UGX)', 'Net (UGX)']],
    body: categories.map(cat => {
      const catEntries = filtered.filter(e => e.category === cat);
      const catDebits = catEntries.reduce((s, e) => s + e.debit, 0);
      const catCredits = catEntries.reduce((s, e) => s + e.credit, 0);
      return [cat, catEntries.length.toString(), fmtCurrency(catDebits), fmtCurrency(catCredits), fmtCurrency(catDebits - catCredits)];
    }),
    theme: 'grid',
    headStyles: { fillColor: [245, 158, 11], fontSize: 8, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: [255, 251, 235] },
    margin: { left: 14, right: 14 },
  });

  y = (doc as any).lastAutoTable.finalY + 10;

  // Detailed entries
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...DARK_COLOR);
  doc.text('DETAILED TRANSACTIONS', 14, y);
  y += 4;

  autoTable(doc, {
    startY: y,
    head: [['ID', 'Date', 'Description', 'Reference', 'Category', 'Member', 'Debit (UGX)', 'Credit (UGX)', 'Balance (UGX)']],
    body: filtered.map(e => [
      e.id,
      e.date,
      e.description,
      e.reference,
      e.category,
      e.memberName || '-',
      e.debit > 0 ? fmtCurrency(e.debit) : '-',
      e.credit > 0 ? fmtCurrency(e.credit) : '-',
      fmtCurrency(e.balance),
    ]),
    theme: 'grid',
    headStyles: { fillColor: PRIMARY_COLOR, fontSize: 7, fontStyle: 'bold' },
    bodyStyles: { fontSize: 7 },
    alternateRowStyles: { fillColor: LIGHT_BG },
    margin: { left: 14, right: 14 },
  });

  addFooter(doc);
  doc.save(`SACCOPro_Cashbook_${dateFrom}_to_${dateTo}.pdf`);
}

export function generateTrialBalance(
  ledgerAccounts: LedgerAccount[],
  _dateFrom: string,
  dateTo: string
) {
  const doc = new jsPDF();
  let y = addHeader(doc, 'Trial Balance', 'General Ledger Account Balances Summary', `As at ${dateTo}`);

  const totalDebits = ledgerAccounts.reduce((s, a) => {
    if (a.type === 'Asset' || a.type === 'Expense') return s + Math.abs(a.balance);
    return s;
  }, 0);
  const totalCredits = ledgerAccounts.reduce((s, a) => {
    if (a.type === 'Liability' || a.type === 'Equity' || a.type === 'Income') return s + Math.abs(a.balance);
    return s;
  }, 0);

  y = addSummaryBox(doc, y, [
    { label: 'Total Accounts', value: ledgerAccounts.length.toString() },
    { label: 'Total Debits', value: fmtCurrency(totalDebits) },
    { label: 'Total Credits', value: fmtCurrency(totalCredits) },
    { label: 'Difference', value: fmtCurrency(Math.abs(totalDebits - totalCredits)) },
  ]);

  autoTable(doc, {
    startY: y + 4,
    head: [['Account Code', 'Account Name', 'Type', 'Category', 'Debit (UGX)', 'Credit (UGX)']],
    body: [
      ...ledgerAccounts.map(a => {
        const isDebit = a.type === 'Asset' || a.type === 'Expense';
        return [
          a.code,
          a.name,
          a.type,
          a.category,
          isDebit ? fmtCurrency(Math.abs(a.balance)) : '-',
          !isDebit ? fmtCurrency(Math.abs(a.balance)) : '-',
        ];
      }),
      [
        '',
        { content: 'TOTALS', styles: { fontStyle: 'bold' } },
        '',
        '',
        { content: fmtCurrency(totalDebits), styles: { fontStyle: 'bold' } },
        { content: fmtCurrency(totalCredits), styles: { fontStyle: 'bold' } },
      ],
    ],
    theme: 'grid',
    headStyles: { fillColor: [99, 102, 241], fontSize: 8, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: [238, 242, 255] },
    margin: { left: 14, right: 14 },
    didParseCell: (data) => {
      if (data.column.index === 2 && data.section === 'body') {
        const val = String(data.cell.raw);
        if (val === 'Asset') data.cell.styles.textColor = [59, 130, 246];
        else if (val === 'Liability') data.cell.styles.textColor = [239, 68, 68];
        else if (val === 'Equity') data.cell.styles.textColor = [139, 92, 246];
        else if (val === 'Income') data.cell.styles.textColor = [16, 185, 129];
        else if (val === 'Expense') data.cell.styles.textColor = [245, 158, 11];
        data.cell.styles.fontStyle = 'bold';
      }
    },
  });

  // Balance check
  y = (doc as any).lastAutoTable.finalY + 10;
  const balanced = Math.abs(totalDebits - totalCredits) < 1;
  doc.setFillColor(balanced ? 236 : 254, balanced ? 253 : 226, balanced ? 245 : 226);
  doc.roundedRect(14, y, doc.internal.pageSize.getWidth() - 28, 16, 2, 2, 'F');
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(balanced ? 5 : 185, balanced ? 150 : 28, balanced ? 105 : 28);
  doc.text(balanced ? 'TRIAL BALANCE IS BALANCED' : `TRIAL BALANCE DIFFERENCE: ${fmtCurrency(Math.abs(totalDebits - totalCredits))}`, 20, y + 10);

  addFooter(doc);
  doc.save(`SACCOPro_Trial_Balance_${dateTo}.pdf`);
}
