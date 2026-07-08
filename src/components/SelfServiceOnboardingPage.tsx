import React, { useMemo, useState } from "react";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  CircleDollarSign,
  ClipboardList,
  Loader2,
  MapPin,
} from "lucide-react";

import { APP_NAME } from "@/constants/branding";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

type TemplateCode =
  | "hotel"
  | "retail"
  | "restaurant"
  | "manufacturing"
  | "sacco"
  | "vsla"
  | "school"
  | "clinic"
  | "agriculture";

type Template = {
  code: TemplateCode;
  label: string;
  description: string;
  defaults: string[];
  questions: Array<{ key: string; label: string; placeholder: string; type?: "text" | "number" | "select"; options?: string[] }>;
};

const TEMPLATES: Template[] = [
  {
    code: "hotel",
    label: "Hotel",
    description: "Rooms, reservations, housekeeping, POS, guest billing, and hotel reports.",
    defaults: ["Reception", "Housekeeping", "Kitchen", "Restaurant", "Bar", "Laundry", "Maintenance"],
    questions: [
      { key: "room_count", label: "Number of rooms", placeholder: "24", type: "number" },
      { key: "room_format", label: "Room numbering format", placeholder: "101, 102, 201..." },
      { key: "vat_registered", label: "VAT registered?", placeholder: "No", type: "select", options: ["No", "Yes"] },
    ],
  },
  {
    code: "retail",
    label: "Retail Shop",
    description: "POS, inventory, purchases, customers, sales reports, and stock controls.",
    defaults: ["Sales Counter", "Store / Warehouse", "Administration", "Sales"],
    questions: [
      { key: "main_products", label: "Main products sold", placeholder: "Groceries, hardware, cosmetics..." },
      { key: "stock_locations", label: "Stock locations", placeholder: "1", type: "number" },
      { key: "vat_registered", label: "VAT registered?", placeholder: "No", type: "select", options: ["No", "Yes"] },
    ],
  },
  {
    code: "restaurant",
    label: "Restaurant",
    description: "Kitchen, bar, menu items, POS, stock, purchases, and daily sales reports.",
    defaults: ["Kitchen", "Restaurant", "Bar", "Store / Warehouse", "Administration"],
    questions: [
      { key: "outlets", label: "Number of outlets", placeholder: "1", type: "number" },
      { key: "has_bar", label: "Has bar sales?", placeholder: "Yes", type: "select", options: ["Yes", "No"] },
      { key: "vat_registered", label: "VAT registered?", placeholder: "No", type: "select", options: ["No", "Yes"] },
    ],
  },
  {
    code: "manufacturing",
    label: "Manufacturing",
    description: "Raw materials, WIP, finished goods, production batches, costing, and overheads.",
    defaults: ["Production", "Store / Warehouse", "Quality Control", "Administration", "Sales"],
    questions: [
      { key: "main_products", label: "Main products manufactured", placeholder: "Furniture, food products, garments..." },
      { key: "costing_method", label: "Preferred costing method", placeholder: "Weighted average", type: "select", options: ["Weighted average", "FIFO", "Standard costing"] },
      { key: "uses_batches", label: "Track production batches?", placeholder: "Yes", type: "select", options: ["Yes", "No"] },
    ],
  },
  {
    code: "sacco",
    label: "SACCO",
    description: "Members, savings, loans, teller operations, cashbook, and regulatory reports.",
    defaults: ["Loans", "Savings", "Teller", "Administration", "Support"],
    questions: [
      { key: "member_count", label: "Approximate members", placeholder: "250", type: "number" },
      { key: "loan_products", label: "Loan products to start with", placeholder: "Emergency, business, salary..." },
      { key: "branches", label: "Branches", placeholder: "1", type: "number" },
    ],
  },
  {
    code: "vsla",
    label: "VSLA",
    description: "Groups, member savings, share-outs, loans, meetings, cashbook, and reports.",
    defaults: ["Members", "Savings", "Loans", "Cash Office", "Administration"],
    questions: [
      { key: "member_count", label: "Approximate members", placeholder: "30", type: "number" },
      { key: "cycle_length", label: "Savings cycle", placeholder: "12 months" },
      { key: "meeting_frequency", label: "Meeting frequency", placeholder: "Weekly", type: "select", options: ["Weekly", "Fortnightly", "Monthly"] },
    ],
  },
  {
    code: "school",
    label: "School",
    description: "Students, classes, fees, receipts, parents, bursary, and school reports.",
    defaults: ["Academic", "Boarding", "Bursary", "Administration", "Support"],
    questions: [
      { key: "student_count", label: "Approximate students", placeholder: "400", type: "number" },
      { key: "school_level", label: "School level", placeholder: "Primary", type: "select", options: ["Primary", "Secondary", "Vocational", "Mixed"] },
      { key: "boarding", label: "Has boarding?", placeholder: "No", type: "select", options: ["No", "Yes"] },
    ],
  },
  {
    code: "clinic",
    label: "Clinic / Pharmacy",
    description: "Patients, consultations, lab, pharmacy POS, medicines, inventory, and clinic reports.",
    defaults: ["Clinical Services", "Laboratory", "Pharmacy", "Administration", "Support"],
    questions: [
      { key: "clinic_type", label: "Clinic type", placeholder: "Clinic", type: "select", options: ["Clinic", "Pharmacy", "Clinic and pharmacy"] },
      { key: "has_lab", label: "Has laboratory?", placeholder: "No", type: "select", options: ["No", "Yes"] },
      { key: "vat_registered", label: "VAT registered?", placeholder: "No", type: "select", options: ["No", "Yes"] },
    ],
  },
  {
    code: "agriculture",
    label: "Agriculture / Farm",
    description: "Farm activities, stock, purchases, sales, cost centres, and seasonal reporting.",
    defaults: ["Field Operations", "Processing", "Store / Warehouse", "Administration", "Sales"],
    questions: [
      { key: "farm_activity", label: "Main activity", placeholder: "Crop, livestock, mixed..." },
      { key: "season_tracking", label: "Track seasons?", placeholder: "Yes", type: "select", options: ["Yes", "No"] },
      { key: "stock_locations", label: "Stock locations", placeholder: "1", type: "number" },
    ],
  },
];

const COUNTRIES = ["Uganda", "Kenya", "Tanzania", "Rwanda", "South Sudan", "Other"];
const CURRENCIES = ["UGX", "KES", "TZS", "RWF", "USD"];

export const SelfServiceOnboardingPage: React.FC = () => {
  const { user, selectOrganization, signOut } = useAuth();
  const [businessName, setBusinessName] = useState("");
  const [country, setCountry] = useState("Uganda");
  const [currency, setCurrency] = useState("UGX");
  const [templateCode, setTemplateCode] = useState<TemplateCode>("hotel");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);

  const template = useMemo(
    () => TEMPLATES.find((item) => item.code === templateCode) ?? TEMPLATES[0],
    [templateCode]
  );

  const updateAnswer = (key: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [key]: value }));
  };

  const createOrganization = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!businessName.trim()) {
      setError("Enter the business name.");
      return;
    }

    setSaving(true);
    const { data, error: rpcError } = await supabase.rpc("create_self_service_organization", {
      p_business_name: businessName.trim(),
      p_business_type: template.code,
      p_country: country,
      p_currency: currency,
      p_admin_full_name: user?.full_name || user?.email || "",
      p_phone: user?.phone || "",
      p_answers: answers,
    });

    if (rpcError) {
      setSaving(false);
      setError(rpcError.message);
      return;
    }

    const organizationId = String((data as { organization_id?: string } | null)?.organization_id ?? "");
    if (!organizationId) {
      setSaving(false);
      setError("The organization was created, but BOAT could not open it automatically.");
      return;
    }

    const { error: selectError } = await selectOrganization(organizationId);
    setSaving(false);
    if (selectError) {
      setCreated(true);
      setError(`Setup completed, but opening the workspace needs a refresh: ${selectError.message}`);
      return;
    }
    setCreated(true);
  };

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-6 sm:px-6 lg:px-8">
        <header className="mb-5 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-emerald-700">{APP_NAME}</p>
            <h1 className="text-2xl font-bold text-slate-950">Set up your business</h1>
          </div>
          <button
            type="button"
            onClick={() => void signOut()}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Sign out
          </button>
        </header>

        <form onSubmit={(event) => void createOrganization(event)} className="grid flex-1 gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-5 flex items-start gap-3">
              <div className="rounded-md bg-emerald-50 p-2 text-emerald-700">
                <Building2 className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-950">Business profile</h2>
                <p className="text-sm text-slate-600">BOAT will create the accounts, roles, settings, and allocation defaults for this template.</p>
              </div>
            </div>

            {error ? (
              <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {error}
              </div>
            ) : null}

            {created ? (
              <div className="mb-4 flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                <CheckCircle2 className="h-4 w-4" />
                Setup completed. Opening your workspace...
              </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block sm:col-span-2">
                <span className="text-sm font-semibold text-slate-800">Business name</span>
                <input
                  value={businessName}
                  onChange={(event) => setBusinessName(event.target.value)}
                  className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                  placeholder="Example: Lake View Traders"
                  required
                />
              </label>

              <label className="block">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                  <MapPin className="h-4 w-4" /> Country
                </span>
                <select
                  value={country}
                  onChange={(event) => setCountry(event.target.value)}
                  className="mt-1 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                >
                  {COUNTRIES.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                  <CircleDollarSign className="h-4 w-4" /> Currency
                </span>
                <select
                  value={currency}
                  onChange={(event) => setCurrency(event.target.value)}
                  className="mt-1 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                >
                  {CURRENCIES.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-6">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-600">
                <ClipboardList className="h-4 w-4" /> Business type
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {TEMPLATES.map((item) => (
                  <button
                    key={item.code}
                    type="button"
                    onClick={() => {
                      setTemplateCode(item.code);
                      setAnswers({});
                    }}
                    className={`min-h-24 rounded-md border p-3 text-left transition-colors ${
                      templateCode === item.code
                        ? "border-emerald-500 bg-emerald-50 text-emerald-950"
                        : "border-slate-200 bg-white text-slate-800 hover:border-slate-300"
                    }`}
                  >
                    <span className="block text-sm font-bold">{item.label}</span>
                    <span className="mt-1 block text-xs leading-5 text-slate-600">{item.description}</span>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <aside className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold text-slate-950">{template.label} template</h2>
            <p className="mt-1 text-sm text-slate-600">{template.description}</p>

            <div className="mt-5">
              <h3 className="text-sm font-bold text-slate-800">Default departments</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {template.defaults.map((item) => (
                  <span key={item} className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                    {item}
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-5 space-y-3">
              <h3 className="text-sm font-bold text-slate-800">Quick questions</h3>
              {template.questions.map((question) => (
                <label key={question.key} className="block">
                  <span className="text-sm font-semibold text-slate-700">{question.label}</span>
                  {question.type === "select" ? (
                    <select
                      value={answers[question.key] ?? question.options?.[0] ?? ""}
                      onChange={(event) => updateAnswer(question.key, event.target.value)}
                      className="mt-1 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                    >
                      {(question.options ?? []).map((option) => (
                        <option key={option}>{option}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={question.type ?? "text"}
                      value={answers[question.key] ?? ""}
                      onChange={(event) => updateAnswer(question.key, event.target.value)}
                      className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                      placeholder={question.placeholder}
                    />
                  )}
                </label>
              ))}
            </div>

            <div className="mt-6 rounded-md border border-slate-200 bg-slate-50 p-3">
              <h3 className="text-sm font-bold text-slate-800">Created automatically</h3>
              <ul className="mt-2 space-y-1 text-sm text-slate-600">
                <li>Chart of accounts and journal account settings</li>
                <li>Cost centres, allocation drivers, and allocation rules</li>
                <li>Departments, starter records, tax defaults, and payment methods</li>
                <li>Staff roles, module settings, and starter trial workspace</li>
              </ul>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-bold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              {saving ? "Creating workspace..." : "Create workspace"}
            </button>
          </aside>
        </form>
      </div>
    </div>
  );
};
