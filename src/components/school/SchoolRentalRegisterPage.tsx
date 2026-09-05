import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Building2, RefreshCw } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { businessTodayISO } from '@/lib/timezone';
import { fetchAllPages } from '@/lib/supabasePagination';
import { buildInvoiceSettlementMap, invoiceBalanceDue } from '@/lib/invoicePaymentAllocations';
import { SCHOOL_PAGE } from '@/lib/schoolPages';

type Property = { id: string; name: string; tenant_id: string | null; monthly_rent: number; due_day: number; revenue_account_id: string; is_active: boolean };
type Tenant = { id: string; name: string };
type Invoice = { id: string; invoice_number: string; rental_property_id: string; customer_id: string; customer_name: string; total: number; issue_date: string; due_date: string; notes: string; status: string };
type Payment = { id: string; paid_at: string; payment_status: string; invoice_allocations: unknown };
type Account = { id: string; account_code: string; account_name: string; account_type: string };
type Props = { readOnly?: boolean; onNavigate: (page: string, state?: Record<string, unknown>) => void };
const blank = { id: '', name: '', tenant_id: '', monthly_rent: '', due_day: '1', revenue_account_id: '', is_active: true };
const money = (value: number) => Number(value).toLocaleString('en-UG', { maximumFractionDigits: 2 });
const errorText = (error: unknown) => error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error);
// New schema is supplied by the school_rental_register migration.
const db = supabase as any;

export function SchoolRentalRegisterPage({ readOnly = false, onNavigate }: Props) {
  const { user } = useAuth();
  const orgId = user?.organization_id;
  const [month, setMonth] = useState(() => businessTodayISO().slice(0, 7));
  const [properties, setProperties] = useState<Property[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [form, setForm] = useState(blank);
  const [showSetup, setShowSetup] = useState(false);
  const [tenantName, setTenantName] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const generation = useRef(0);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<Invoice | null>(null);

  const load = useCallback(async () => {
    const run = ++generation.current;
    if (!orgId || !/^\d{4}-\d{2}$/.test(month)) { setLoading(false); return; }
    setLoading(true); setReady(false); setError('');
    try {
      const [propertyRows, tenantRows, invoiceRows, paymentRows, accountResult] = await Promise.all([
        fetchAllPages<Property>((from, to) => db.from('school_rental_properties').select('*').eq('organization_id', orgId).order('id').range(from, to)),
        fetchAllPages<Tenant>((from, to) => supabase.from('retail_customers').select('id,name').eq('organization_id', orgId).order('id').range(from, to)),
        fetchAllPages<Invoice>((from, to) => db.from('retail_invoices').select('*').eq('organization_id', orgId).eq('rental_month', `${month}-01`).not('rental_property_id', 'is', null).order('id').range(from, to)),
        fetchAllPages<Payment>((from, to) => supabase.from('payments').select('id,paid_at,payment_status,invoice_allocations').eq('organization_id', orgId).eq('payment_status', 'completed').not('invoice_allocations', 'is', null).order('id').range(from, to)),
        supabase.from('gl_accounts').select('id,account_code,account_name,account_type').eq('organization_id', orgId).eq('is_active', true).order('account_code'),
      ]);
      if (accountResult.error) throw accountResult.error;
      if (run !== generation.current) return;
      setProperties(propertyRows.sort((a, b) => a.name.localeCompare(b.name)));
      setTenants(tenantRows.sort((a, b) => a.name.localeCompare(b.name)));
      setInvoices(invoiceRows); setPayments(paymentRows);
      setAccounts((accountResult.data || []).filter((a) => ['income', 'revenue'].includes(a.account_type)));
      setAmounts(Object.fromEntries(propertyRows.map((p) => [p.id, String(p.monthly_rent)])));
      setReady(true);
    } catch (e) {
      if (run === generation.current) setError(`Could not load rental register: ${errorText(e)}`);
    } finally { if (run === generation.current) setLoading(false); }
  }, [orgId, month]);
  useEffect(() => { void load(); return () => { generation.current += 1; }; }, [load]);

  const settlement = useMemo(() => buildInvoiceSettlementMap(payments), [payments]);
  const invoiceByProperty = useMemo(() => new Map(invoices.map((i) => [i.rental_property_id, i])), [invoices]);
  const tenantById = useMemo(() => new Map(tenants.map((t) => [t.id, t.name])), [tenants]);
  const visible = properties.filter((p) => {
    const invoice = invoiceByProperty.get(p.id);
    if (filter === 'uncharged' && (invoice || !p.is_active || !p.tenant_id)) return false;
    if (filter === 'outstanding' && (!invoice || invoiceBalanceDue(invoice, settlement) <= 0)) return false;
    if (filter === 'vacant' && p.tenant_id) return false;
    return `${p.name} ${invoice?.customer_name || tenantById.get(p.tenant_id || '') || ''}`.toLowerCase().includes(search.toLowerCase());
  });
  const eligible = visible.filter((p) => p.is_active && p.tenant_id && !invoiceByProperty.has(p.id));
  const charged = invoices.reduce((sum, i) => sum + Number(i.total), 0);
  const balance = invoices.reduce((sum, i) => sum + invoiceBalanceDue(i, settlement), 0);

  const saveProperty = async () => {
    if (readOnly || !orgId || inFlight.current) return;
    const rent = Number(form.monthly_rent), due = Number(form.due_day);
    if (!form.name.trim() || !Number.isFinite(rent) || rent <= 0 || !Number.isInteger(due) || due < 1 || due > 28 || !form.revenue_account_id) {
      setError('Enter a property name, positive monthly rent, due day from 1 to 28, and rental income account.'); return;
    }
    inFlight.current = true; setBusy(true); setError('');
    try {
      const values = { organization_id: orgId, name: form.name.trim(), tenant_id: form.tenant_id || null, monthly_rent: rent, due_day: due, revenue_account_id: form.revenue_account_id, is_active: form.is_active };
      const result = form.id
        ? await db.from('school_rental_properties').update(values).eq('id', form.id).eq('organization_id', orgId).select('id').single()
        : await db.from('school_rental_properties').insert(values).select('id').single();
      if (result.error) throw result.error;
      setForm(blank); setShowSetup(false); setMessage('Property saved. Existing invoices retain their original tenant and charges.'); await load();
    } catch (e) { setError(errorText(e)); }
    finally { inFlight.current = false; setBusy(false); }
  };

  const addTenant = async () => {
    if (readOnly || !orgId || !tenantName.trim() || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const result = await supabase.from('retail_customers').insert({ organization_id: orgId, name: tenantName.trim() }).select('id,name').single();
      if (result.error) throw result.error;
      setTenants((rows) => [...rows, result.data]); setForm((f) => ({ ...f, tenant_id: result.data.id })); setTenantName('');
    } catch (e) { setError(errorText(e)); }
    finally { inFlight.current = false; setBusy(false); }
  };

  const charge = async (list: Property[]) => {
    if (readOnly || !orgId || inFlight.current || !list.length) return;
    if (list.some((p) => !Number.isFinite(Number(amounts[p.id])) || Number(amounts[p.id]) <= 0)) {
      setError('Each monthly charge must be a positive amount.'); return;
    }
    inFlight.current = true; setBusy(true); setError(''); let done = 0;
    try {
      for (const property of list) {
        setMessage(`Creating invoice ${done + 1} of ${list.length}: ${property.name}…`);
        const result = await db.rpc('charge_school_rental_month', { p_property_id: property.id, p_month: `${month}-01`, p_amount: Number(amounts[property.id]) });
        if (result.error) throw result.error;
        const invoice = result.data as Invoice;
        if (!invoice?.id) throw new Error('The server did not return an invoice. Refresh before retrying.');
        setInvoices((rows) => [...rows.filter((i) => i.id !== invoice.id), invoice]); done += 1;
      }
      setMessage(`${done} monthly invoice${done === 1 ? '' : 's'} ready. Use Receive payment to record collections.`);
    } catch (e) { setError(`${done} invoices completed before stopping. ${errorText(e)}`); setMessage(''); }
    finally { inFlight.current = false; setBusy(false); }
  };

  return <div className="p-6 lg:p-8 space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="text-2xl font-bold flex items-center gap-2"><Building2 className="text-emerald-700" />Rental charges register</h1><p className="mt-2 text-sm text-slate-600">Charge each property once per month, then receive tenant payments against its invoices.</p></div>
      <div className="flex items-end gap-2"><label className="text-sm font-medium">Rental month<input aria-label="Rental month" type="month" value={month} disabled={busy} onChange={(e) => { if (e.target.value) { setMonth(e.target.value); setMessage(''); } }} className="block border rounded-lg p-2" /></label><button aria-label="Refresh rental register" disabled={busy || loading} onClick={() => void load()} className="border rounded-lg p-2"><RefreshCw size={20} /></button></div>
    </div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
    {message && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-emerald-800">{message}</p>}
    <div className="grid grid-cols-3 gap-3">{[['Invoiced', charged], ['Paid', charged - balance], ['Balance', balance]].map(([label, value]) => <div key={label} className="rounded-xl border bg-white p-4"><p className="text-sm text-slate-500">{label} · UGX</p><p className="text-xl font-bold">{money(Number(value))}</p></div>)}</div>
    <div className="flex flex-wrap gap-3 items-center">
      <input aria-label="Search properties or tenants" placeholder="Search property or tenant" value={search} onChange={(e) => setSearch(e.target.value)} className="border rounded-lg p-2" />
      <select aria-label="Register filter" value={filter} onChange={(e) => setFilter(e.target.value)} className="border rounded-lg p-2"><option value="all">All properties</option><option value="uncharged">Not charged</option><option value="outstanding">Outstanding</option><option value="vacant">Vacant</option></select>
      {!readOnly && <><button disabled={busy || !ready} onClick={() => { setForm(blank); setShowSetup(true); }} className="app-btn-primary">Add property</button><button disabled={busy || !ready || !eligible.length} onClick={() => void charge(eligible)} className="app-btn-primary">Charge {eligible.length} matching properties</button></>}
      <button disabled={busy} className="text-emerald-700 font-medium" onClick={() => onNavigate(SCHOOL_PAGE.rentalPayments)}>Rent collections</button>
    </div>
    {showSetup && !readOnly && <section className="rounded-xl border bg-white p-4 space-y-3">
      <h2 className="font-semibold">{form.id ? 'Edit property' : 'Add property'}</h2>
      <div className="grid md:grid-cols-3 gap-3">
        <label className="text-sm">Property / unit<input disabled={busy} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="block w-full border rounded-lg p-2" /></label>
        <label className="text-sm">Tenant<select disabled={busy} value={form.tenant_id} onChange={(e) => setForm({ ...form, tenant_id: e.target.value })} className="block w-full border rounded-lg p-2"><option value="">Vacant</option>{tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        <label className="text-sm">Monthly rent (UGX)<input disabled={busy} type="number" min="0.01" step="0.01" value={form.monthly_rent} onChange={(e) => setForm({ ...form, monthly_rent: e.target.value })} className="block w-full border rounded-lg p-2" /></label>
        <label className="text-sm">Due day of month (1–28)<input disabled={busy} type="number" min="1" max="28" value={form.due_day} onChange={(e) => setForm({ ...form, due_day: e.target.value })} className="block w-full border rounded-lg p-2" /></label>
        <label className="text-sm">Rental income account<select disabled={busy} value={form.revenue_account_id} onChange={(e) => setForm({ ...form, revenue_account_id: e.target.value })} className="block w-full border rounded-lg p-2"><option value="">Select income account</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.account_code} — {a.account_name}</option>)}</select></label>
        <label className="flex gap-2 items-center text-sm"><input disabled={busy} type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />Active property</label>
      </div>
      <div className="flex flex-wrap items-center gap-2"><input disabled={busy} aria-label="New tenant name" placeholder="New tenant name" value={tenantName} onChange={(e) => setTenantName(e.target.value)} className="border rounded-lg p-2" /><button disabled={busy || !tenantName.trim()} onClick={() => void addTenant()} className="border rounded-lg px-3 py-2">Add tenant</button><button disabled={busy} onClick={() => void saveProperty()} className="app-btn-primary">Save property</button><button disabled={busy} onClick={() => setShowSetup(false)} className="px-3 py-2">Cancel</button></div>
      <p className="text-xs text-slate-500">An issued charge posts to receivables and the selected rental income account. Changes to property setup apply to future charges.</p>
    </section>}
    <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full text-sm"><thead className="bg-slate-50"><tr>{['Property', 'Tenant', 'Monthly charge (UGX)', 'Invoice', 'Paid', 'Balance', 'Actions'].map((h) => <th key={h} className="p-3 text-left">{h}</th>)}</tr></thead><tbody>
      {loading ? <tr><td colSpan={7} className="p-6">Loading rental register…</td></tr> : visible.map((p) => {
        const invoice = invoiceByProperty.get(p.id), paid = invoice ? settlement[invoice.id]?.paid || 0 : 0;
        return <tr key={p.id} className="border-t"><td className="p-3 font-semibold">{p.name}{!p.is_active && <span className="block text-xs text-slate-500">Inactive</span>}</td><td className="p-3">{invoice?.customer_name || tenantById.get(p.tenant_id || '') || 'Vacant'}</td>
          <td className="p-3">{invoice ? money(invoice.total) : <input aria-label={`Monthly charge for ${p.name}`} disabled={readOnly || busy || !p.is_active || !p.tenant_id} type="number" min="0.01" step="0.01" value={amounts[p.id] || ''} onChange={(e) => setAmounts({ ...amounts, [p.id]: e.target.value })} className="w-36 border rounded-lg p-2 text-right" />}</td>
          <td className="p-3">{invoice ? <button className="text-emerald-700 underline" onClick={() => setPreview(invoice)}>View invoice</button> : 'Not charged'}</td><td className="p-3">{money(paid)}</td><td className="p-3 font-semibold">{invoice ? money(invoiceBalanceDue(invoice, settlement)) : '—'}</td>
          <td className="p-3"><div className="flex gap-3">{!readOnly && <>{invoice ? invoiceBalanceDue(invoice, settlement) > 0 ? <button disabled={busy} className="text-emerald-700 font-medium" onClick={() => onNavigate(SCHOOL_PAGE.rentalPayments, { rentalCustomerId: invoice.customer_id, openRecordPayment: true })}>Receive payment</button> : <span className="text-emerald-700">Paid</span> : <button disabled={busy || !ready || !p.tenant_id || !p.is_active} className="app-btn-primary" onClick={() => void charge([p])}>Create invoice</button>}<button disabled={busy} className="text-slate-600 underline" onClick={() => { setForm({ ...p, tenant_id: p.tenant_id || '', monthly_rent: String(p.monthly_rent), due_day: String(p.due_day) }); setShowSetup(true); }}>Edit property</button></>}</div></td></tr>;
      })}
      {!loading && !visible.length && <tr><td colSpan={7} className="p-8 text-slate-500">No properties match. Add the school's rental properties to begin.</td></tr>}
    </tbody></table></div>
    {preview && <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"><section role="dialog" aria-modal="true" aria-label="Rental invoice" className="bg-white rounded-xl p-6 max-w-xl w-full space-y-4"><h2 className="text-xl font-bold">Rental invoice</h2><p className="text-sm break-all">{preview.invoice_number}</p><p>{preview.customer_name}</p><p>{preview.notes}</p><p>Issued: {preview.issue_date} · Due: {preview.due_date}</p><p>Total: UGX {money(preview.total)}</p><p>Paid: UGX {money(settlement[preview.id]?.paid || 0)}</p><p className="font-bold">Balance: UGX {money(invoiceBalanceDue(preview, settlement))}</p><button onClick={() => setPreview(null)} className="app-btn-primary">Close</button></section></div>}
  </div>;
}

