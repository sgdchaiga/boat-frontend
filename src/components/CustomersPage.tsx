import { useCallback, useEffect, useState } from "react";
import { Users, Plus, Mail, Phone } from "lucide-react";
import { supabase } from "../lib/supabase";
import { enqueueSyncOutbox } from "../lib/syncOutbox";
import { filterByOrganizationId } from "../lib/supabaseOrgFilter";
import { useAuth } from "../contexts/AuthContext";
import { desktopApi } from "../lib/desktopApi";
import type { Database } from "../lib/database.types";
import { PageNotes } from "./common/PageNotes";

type PropertyCustomer = Database["public"]["Tables"]["hotel_customers"]["Row"];

/** Property / hotel customers (`public.hotel_customers`; formerly guests → customers). */
export function CustomersPage({ highlightCustomerId }: { highlightCustomerId?: string }) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;

  const [customers, setCustomers] = useState<PropertyCustomer[]>([]);
  const [loading, setLoading] = useState(true);

  const [searchTerm, setSearchTerm] = useState("");

  const [showModal, setShowModal] = useState(false);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [idType, setIdType] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [address, setAddress] = useState("");
  const [savingCustomer, setSavingCustomer] = useState(false);
  const localAuthEnabled = ["true", "1", "yes"].includes((import.meta.env.VITE_LOCAL_AUTH || "").trim().toLowerCase());
  const useDesktopLocalCustomers = localAuthEnabled && desktopApi.isAvailable();

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    if (useDesktopLocalCustomers) {
      try {
        const rows = await desktopApi.listCustomers();
        setCustomers((rows as PropertyCustomer[]) || []);
      } catch (error) {
        console.error(error);
        setCustomers([]);
      } finally {
        setLoading(false);
      }
      return;
    }
    let q = supabase.from("hotel_customers").select("*").order("created_at", { ascending: false });
    q = filterByOrganizationId(q, orgId, superAdmin);
    const { data, error } = await q;

    if (error) {
      console.error(error);
      setCustomers([]);
      setLoading(false);
      return;
    }

    setCustomers(data || []);
    setLoading(false);
  }, [orgId, superAdmin, useDesktopLocalCustomers]);

  useEffect(() => {
    void fetchCustomers();
  }, [fetchCustomers]);

  useEffect(() => {
    if (!highlightCustomerId || loading) return;
    const id = `customer-card-${highlightCustomerId}`;
    const run = () => {
      const el = document.getElementById(id);
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
    };
    const t = window.setTimeout(run, 100);
    return () => window.clearTimeout(t);
  }, [highlightCustomerId, loading, customers]);

  const createCustomer = async () => {
    if (savingCustomer) return;
    if (!firstName || !lastName) {
      alert("Enter customer name");
      return;
    }

    setSavingCustomer(true);
    try {
      if (useDesktopLocalCustomers) {
        const inserted = await desktopApi.createCustomer({
          first_name: firstName,
          last_name: lastName,
          email: email || null,
          phone: phone || null,
          id_type: idType || null,
          id_number: idNumber || null,
          address: address || null,
        });
        if (!inserted) {
          alert("Failed to save customer locally.");
          return;
        }
        setShowModal(false);
        setFirstName("");
        setLastName("");
        setEmail("");
        setPhone("");
        setIdType("");
        setIdNumber("");
        setAddress("");
        fetchCustomers();
        return;
      }
      const { data: inserted, error } = await supabase
        .from("hotel_customers")
        .insert([
          {
            organization_id: orgId ?? null,
            first_name: firstName,
            last_name: lastName,
            email: email || null,
            phone: phone || null,
            id_type: idType || null,
            id_number: idNumber || null,
            address: address || null,
          },
        ])
        .select("*")
        .single();

      if (error) {
        console.error(error);
        alert(error.message);
        return;
      }

      if (inserted) {
        await enqueueSyncOutbox(supabase, {
          tableName: "hotel_customers",
          operation: "INSERT",
          recordId: inserted.id,
          payload: inserted as Record<string, unknown>,
        });
      }

      setShowModal(false);
      setFirstName("");
      setLastName("");
      setEmail("");
      setPhone("");
      setIdType("");
      setIdNumber("");
      setAddress("");
      fetchCustomers();
    } finally {
      setSavingCustomer(false);
    }
  };

  const filtered = customers.filter((c) => {
    const fullName = `${c.first_name} ${c.last_name}`.toLowerCase();
    const em = c.email?.toLowerCase() || "";
    const ph = c.phone || "";
    return (
      fullName.includes(searchTerm.toLowerCase()) ||
      em.includes(searchTerm.toLowerCase()) ||
      ph.includes(searchTerm)
    );
  });

  if (loading) {
    return <div className="p-6">Loading customers…</div>;
  }

  return (
    <div className="p-6 md:p-8">
      <div className="flex justify-between mb-8">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold">Customers</h1>
            <PageNotes ariaLabel="Customers help">
              <p>Property customers for stays, billing, and sales invoices.</p>
            </PageNotes>
          </div>
        </div>

        <button
          onClick={() => setShowModal(true)}
          className="bg-brand-700 text-white px-4 py-2 rounded-lg flex gap-2"
        >
          <Plus className="w-5 h-5" />
          Add customer
        </button>
      </div>

      <input
        placeholder="Search name, email or phone…"
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        className="border p-2 rounded w-full mb-6"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filtered.map((c) => (
          <div
            key={c.id}
            id={`customer-card-${c.id}`}
            className={`bg-white border p-6 rounded-xl transition-shadow ${
              highlightCustomerId === c.id ? "ring-2 ring-brand-600 shadow-md" : ""
            }`}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="bg-violet-100 p-3 rounded-lg">
                <Users className="w-6 h-6 text-violet-600" />
              </div>

              <div>
                <h3 className="font-bold">
                  {c.first_name} {c.last_name}
                </h3>
                <p className="text-xs text-slate-500">ID: {c.id.slice(0, 8)}</p>
              </div>
            </div>

            {c.email && (
              <p className="text-sm flex items-center gap-2">
                <Mail className="w-4 h-4" />
                {c.email}
              </p>
            )}

            {c.phone && (
              <p className="text-sm flex items-center gap-2 mt-1">
                <Phone className="w-4 h-4" />
                {c.phone}
              </p>
            )}

            {c.id_type && c.id_number && (
              <p className="text-sm mt-2">
                {c.id_type}: {c.id_number}
              </p>
            )}

            {c.address && <p className="text-sm text-slate-500 mt-2">{c.address}</p>}
          </div>
        ))}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-10">
          <div className="bg-white p-6 rounded-xl w-96 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">Add customer</h2>

            <input
              placeholder="First name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="border w-full p-2 mb-3 rounded"
            />

            <input
              placeholder="Last name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="border w-full p-2 mb-3 rounded"
            />

            <input
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="border w-full p-2 mb-3 rounded"
            />

            <input
              placeholder="Phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="border w-full p-2 mb-3 rounded"
            />

            <input
              placeholder="ID type"
              value={idType}
              onChange={(e) => setIdType(e.target.value)}
              className="border w-full p-2 mb-3 rounded"
            />

            <input
              placeholder="ID number"
              value={idNumber}
              onChange={(e) => setIdNumber(e.target.value)}
              className="border w-full p-2 mb-3 rounded"
            />

            <input
              placeholder="Address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="border w-full p-2 mb-3 rounded"
            />

            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => !savingCustomer && setShowModal(false)} disabled={savingCustomer} className="px-4 py-2 bg-gray-200 rounded disabled:opacity-60">
                Cancel
              </button>

              <button type="button" onClick={createCustomer} disabled={savingCustomer} className="px-4 py-2 bg-brand-700 text-white rounded disabled:opacity-60">
                {savingCustomer ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
