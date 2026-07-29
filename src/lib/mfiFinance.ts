export type MfiInterestMethod = "flat" | "declining";
export type MfiInstallmentType = "equal_total" | "equal_principal";

export interface MfiScheduleInput {
  principal: number;
  periodicRate: number;
  periods: number;
  firstDueDate: string;
  frequency: "daily" | "weekly" | "fortnightly" | "monthly" | "quarterly";
  method: MfiInterestMethod;
  installmentType?: MfiInstallmentType;
}

export interface MfiScheduleRow {
  installmentNumber: number;
  dueDate: string;
  openingPrincipal: number;
  principal: number;
  interest: number;
  total: number;
  closingPrincipal: number;
}

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function nextDate(date: Date, frequency: MfiScheduleInput["frequency"]) {
  const next = new Date(date);
  if (frequency === "daily") next.setUTCDate(next.getUTCDate() + 1);
  if (frequency === "weekly") next.setUTCDate(next.getUTCDate() + 7);
  if (frequency === "fortnightly") next.setUTCDate(next.getUTCDate() + 14);
  if (frequency === "monthly") next.setUTCMonth(next.getUTCMonth() + 1);
  if (frequency === "quarterly") next.setUTCMonth(next.getUTCMonth() + 3);
  return next;
}

export function generateMfiSchedule(input: MfiScheduleInput): MfiScheduleRow[] {
  if (!(input.principal > 0) || !(input.periods > 0) || input.periodicRate < 0) {
    throw new Error("Principal and periods must be positive and rate cannot be negative.");
  }
  const periods = Math.floor(input.periods);
  const rate = input.periodicRate / 100;
  const flatInterest = money(input.principal * rate * periods);
  const equalPrincipal = money(input.principal / periods);
  const annuity =
    rate === 0
      ? input.principal / periods
      : (input.principal * rate * Math.pow(1 + rate, periods)) / (Math.pow(1 + rate, periods) - 1);
  let balance = money(input.principal);
  let due = new Date(`${input.firstDueDate}T00:00:00Z`);
  const rows: MfiScheduleRow[] = [];

  for (let index = 0; index < periods; index += 1) {
    const last = index === periods - 1;
    let interest = input.method === "flat" ? money(flatInterest / periods) : money(balance * rate);
    let principal =
      input.method === "declining" && input.installmentType !== "equal_principal"
        ? money(annuity - interest)
        : equalPrincipal;
    if (last) principal = balance;
    if (input.method === "flat" && last) {
      interest = money(flatInterest - rows.reduce((sum, row) => sum + row.interest, 0));
    }
    const closingPrincipal = money(Math.max(0, balance - principal));
    rows.push({
      installmentNumber: index + 1,
      dueDate: due.toISOString().slice(0, 10),
      openingPrincipal: balance,
      principal,
      interest,
      total: money(principal + interest),
      closingPrincipal,
    });
    balance = closingPrincipal;
    due = nextDate(due, input.frequency);
  }
  return rows;
}

export function portfolioAtRisk(
  loans: Array<{ outstandingPrincipal: number; daysPastDue: number }>,
  threshold: number
) {
  const gross = loans.reduce((sum, loan) => sum + Math.max(0, loan.outstandingPrincipal), 0);
  const atRisk = loans
    .filter((loan) => loan.daysPastDue >= threshold)
    .reduce((sum, loan) => sum + Math.max(0, loan.outstandingPrincipal), 0);
  return { gross: money(gross), atRisk: money(atRisk), ratio: gross ? money((atRisk / gross) * 100) : 0 };
}

