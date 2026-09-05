import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { payrollStaffTypes, payrollBusinessLabel, payrollStaffCostReport, mergePayrollProfile } from '../src/lib/payrollBusiness.ts';

test('manufacturing payroll uses industrial staff categories without changing schools', () => {
  assert.equal(payrollBusinessLabel('manufacturing'), 'Manufacturing');
  assert.ok(payrollStaffTypes('manufacturing').includes('Production'));
  assert.ok(payrollStaffTypes('manufacturing').includes('Quality Control'));
  assert.ok(!payrollStaffTypes('manufacturing').some(t => /teaching/i.test(t)));
  assert.deepEqual(payrollStaffTypes('school'), ['Teaching', 'Non-Teaching']);
  assert.equal(payrollStaffCostReport('manufacturing'), 'Payroll Cost by Staff Type');
});
test('employment edits preserve salary and deduction detail while allowing cleared fields', () => {
  const profile = { department: 'Production', bank_name: 'Bank', base_salary: 500000, recurring_deductions: [{ label: 'Uniform', amount: 10000 }, { label: 'Meals', amount: 20000 }] };
  const merged = mergePayrollProfile(profile, { department: 'Maintenance', bank_name: null });
  assert.equal(merged.bank_name, null);
  assert.equal(merged.base_salary, 500000);
  assert.deepEqual(merged.recurring_deductions, profile.recurring_deductions);
});
test('payroll-only employee creation retains login FK protection and is atomic and permission scoped', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260905200000_payroll_only_employees.sql', import.meta.url), 'utf8');
  assert.match(sql, /FOREIGN KEY \(login_user_id\) REFERENCES auth.users\(id\) ON DELETE CASCADE/);
  assert.match(sql, /CHECK \(NOT is_payroll_only OR \(is_active = false AND role = 'payroll_employee'\)\)/);
  assert.match(sql, /public.auth_organization_id\(\)/);
  assert.match(sql, /staff_permission_overrides/);
  assert.match(sql, /permission_key = 'payroll_prepare'/);
  assert.match(sql, /Employee code already exists/);
  assert.match(sql, /INSERT INTO public.staff[\s\S]*INSERT INTO public.payroll_employee_profiles[\s\S]*INSERT INTO public.payroll_audit_log/);
  assert.doesNotMatch(sql, /INSERT INTO auth.users|INSERT INTO public.organization_members/);
});
