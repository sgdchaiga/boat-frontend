export type StandardSchoolBudgetLine = {
  line_label: string;
  budget_type: "income" | "operating_expense" | "staff_cost" | "capital_expenditure";
  assumptions: string;
};

/**
 * Standard school budget catalogue, adapted from the Tuyige S.S master budget.
 * Amounts deliberately start at zero so every school supplies its own assumptions.
 * Loans and opening balances are excluded because they belong in financing/treasury,
 * not operating income.
 */
export const STANDARD_SCHOOL_BUDGET_LINES: StandardSchoolBudgetLine[] = [
  { line_label: "School fees", budget_type: "income", assumptions: "Expected enrolment × approved fees × collection rate." },
  { line_label: "Examination income", budget_type: "income", assumptions: "Examination charges expected from learners." },
  { line_label: "Stationery income", budget_type: "income", assumptions: "Stationery charges expected from learners." },
  { line_label: "Admission fees", budget_type: "income", assumptions: "New admissions × approved admission fee." },
  { line_label: "One-off fees", budget_type: "income", assumptions: "Non-recurring learner charges." },
  { line_label: "Photos income", budget_type: "income", assumptions: "Student photo charges." },
  { line_label: "Uniform income", budget_type: "income", assumptions: "Expected uniform sales or charges." },
  { line_label: "Donor and partner contributions", budget_type: "income", assumptions: "Grants or programme contributions, such as UKIHI support." },

  { line_label: "Salaries and allowances", budget_type: "staff_cost", assumptions: "Employees × months × monthly salary and allowances." },
  { line_label: "Recruitment costs", budget_type: "staff_cost", assumptions: "Advertising, interviews and onboarding costs." },
  { line_label: "Academic and library improvement", budget_type: "operating_expense", assumptions: "Learning materials, tests, awards and library resources." },
  { line_label: "Examination expenses", budget_type: "operating_expense", assumptions: "Internal, mock and national examination costs." },
  { line_label: "Workshops and seminars", budget_type: "operating_expense", assumptions: "Student and staff workshops and seminars." },
  { line_label: "Educational tours", budget_type: "operating_expense", assumptions: "Geography and other approved educational tours." },
  { line_label: "SESEMAT", budget_type: "operating_expense", assumptions: "SESEMAT programme costs and contributions." },
  { line_label: "Laboratory", budget_type: "operating_expense", assumptions: "Science and computer laboratory operations." },
  { line_label: "Magazines and books", budget_type: "operating_expense", assumptions: "Magazines, prayer books and other books." },
  { line_label: "Co-curricular activities", budget_type: "operating_expense", assumptions: "Sports, music, dance and drama activities." },
  { line_label: "Guidance and counselling", budget_type: "operating_expense", assumptions: "Student guidance and counselling activities." },
  { line_label: "Education fund", budget_type: "operating_expense", assumptions: "Education fund contribution or programme cost." },
  { line_label: "Liturgy", budget_type: "operating_expense", assumptions: "School worship, retreats and religious activities." },
  { line_label: "Community or parish contribution", budget_type: "operating_expense", assumptions: "Approved community or parish contributions." },
  { line_label: "Catering and welfare", budget_type: "operating_expense", assumptions: "Students × feeding days × daily cost, plus staff welfare." },
  { line_label: "Board governance expenses", budget_type: "operating_expense", assumptions: "Board meetings, transport refunds and refreshments." },
  { line_label: "Outreach activities", budget_type: "operating_expense", assumptions: "Public relations, mobilisation and community outreach." },
  { line_label: "School celebrations and events", budget_type: "operating_expense", assumptions: "Approved school celebrations and special events." },
  { line_label: "Communication and airtime", budget_type: "operating_expense", assumptions: "Official calls, data and airtime." },
  { line_label: "Meetings", budget_type: "operating_expense", assumptions: "Routine staff and management meetings." },
  { line_label: "Printing and stationery", budget_type: "operating_expense", assumptions: "Printing, photocopying and office stationery." },
  { line_label: "Health and sanitation", budget_type: "operating_expense", assumptions: "Medical supplies, sanitation and student health services." },
  { line_label: "Transport", budget_type: "operating_expense", assumptions: "Operational transport and staff transport refunds." },
  { line_label: "Student photos", budget_type: "operating_expense", assumptions: "Cost of producing student photographs." },
  { line_label: "Uniform purchases", budget_type: "operating_expense", assumptions: "Cost of uniforms purchased for issue or resale." },
  { line_label: "Bank charges and loan interest", budget_type: "operating_expense", assumptions: "Bank fees and interest only; loan principal is financing." },
  { line_label: "Utilities", budget_type: "operating_expense", assumptions: "Water, electricity and related utility costs." },
  { line_label: "Entertainment", budget_type: "operating_expense", assumptions: "Approved staff or school entertainment." },
  { line_label: "Repairs and maintenance", budget_type: "operating_expense", assumptions: "Buildings, equipment and furniture maintenance." },
  { line_label: "Generator expenses", budget_type: "operating_expense", assumptions: "Fuel, oil, servicing and generator repairs." },
  { line_label: "Compound maintenance", budget_type: "operating_expense", assumptions: "Grounds and compound maintenance." },
  { line_label: "Creditor settlements", budget_type: "operating_expense", assumptions: "Planned settlement of valid prior obligations; reconcile to payables." },
  { line_label: "Capital projects", budget_type: "capital_expenditure", assumptions: "Renovations, construction and other capital improvements." },
];

export function standardSchoolBudgetLineRows(budgetId: string) {
  return STANDARD_SCHOOL_BUDGET_LINES.map((line, index) => ({
    budget_id: budgetId,
    ...line,
    amount: 0,
    term_1_amount: 0,
    term_2_amount: 0,
    term_3_amount: 0,
    annual_other_amount: 0,
    sort_order: index,
    frequency: "one_time",
  }));
}
