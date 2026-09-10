type Student = { id: string; class_id: string | null; class_name: string; status: string };
type Invoice = { student_id: string; fee_structure_id?: string | null; academic_year: string; term_name: string; status: string };
type Fee = { id: string; class_id: string | null; class_name: string; academic_year: string; term_name: string };

export function schoolInvoiceCoverage(students: Student[], invoices: Invoice[], fee: Fee) {
  const name = fee.class_name.trim().toLowerCase();
  const classStudents = students.filter((student) => fee.class_id && student.class_id
    ? student.class_id === fee.class_id
    : !!name && student.class_name?.trim().toLowerCase() === name);
  const termInvoices = invoices.filter((invoice) => invoice.academic_year === fee.academic_year && invoice.term_name === fee.term_name);
  const withInvoice = new Set(termInvoices.map((invoice) => invoice.student_id));
  const withSelected = new Set(termInvoices.filter((invoice) => invoice.fee_structure_id === fee.id && invoice.status !== "cancelled").map((invoice) => invoice.student_id));
  const withOther = new Set(termInvoices.filter((invoice) => invoice.fee_structure_id !== fee.id && invoice.status !== "cancelled").map((invoice) => invoice.student_id));
  const withLiveInvoice = new Set(termInvoices.filter((invoice) => invoice.status !== "cancelled").map((invoice) => invoice.student_id));
  return {
    students: classStudents.length,
    matchingInvoices: invoices.filter((invoice) => invoice.fee_structure_id === fee.id && invoice.status !== "cancelled").length,
    selectedStudents: classStudents.filter((student) => withSelected.has(student.id)).length,
    otherStudents: classStudents.filter((student) => !withSelected.has(student.id) && withOther.has(student.id)).length,
    cancelledStudents: classStudents.filter((student) => withInvoice.has(student.id) && !withLiveInvoice.has(student.id)).length,
    missingStudents: classStudents.filter((student) => !withInvoice.has(student.id)),
  };
}
