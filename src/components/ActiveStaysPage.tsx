import { useEffect, useState } from 'react';
import { DoorOpen, LogOut, Printer } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { GuestBill } from './GuestBill';
import { useAuth } from '../contexts/AuthContext';
import type { Database } from '../lib/database.types';
import { PageNotes } from './common/PageNotes';
import { filterByOrganizationId } from '../lib/supabaseOrgFilter';

type Stay = Database['public']['Tables']['stays']['Row'] & {
  /** Returned from `select('*')` on stays; used for printed guest bill header. */
  organization_id?: string | null;
  hotel_customers: { first_name: string; last_name: string; email: string | null } | null;
  rooms: { id: string; room_number: string } | null;
};

export function ActiveStaysPage() {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;
  const [stays, setStays] = useState<Stay[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [billStay, setBillStay] = useState<Stay | null>(null);

  useEffect(() => {
    fetchActiveStays();
  }, [orgId, superAdmin]);

  const fetchActiveStays = async () => {
  try {
    if (!orgId && !superAdmin) {
      setStays([]);
      return;
    }
    const { data, error } = await filterByOrganizationId(
      supabase
        .from("stays")
        .select("*, hotel_customers(first_name,last_name,email), rooms(id,room_number)")
        .is("actual_check_out", null)
        .order("actual_check_in", { ascending: false }),
      orgId,
      superAdmin
    );

    if (error) throw error;

    setStays(data || []);
  } catch (error) {
    console.error("Error fetching stays:", error);
  } finally {
    setLoading(false);
  }
};
  const handleCheckOut = async (stay: Stay) => {
    if (!stay.rooms || !user) return;

    setProcessingId(stay.id);
    try {
      const updatePayload: { actual_check_out: string; checked_out_by?: string } = {
        actual_check_out: new Date().toISOString(),
      };
      const { data: staffRow } = await supabase
        .from('staff')
        .select('id')
        .eq('id', user.id)
        .eq('organization_id', orgId ?? '')
        .maybeSingle();
      if (staffRow?.id) updatePayload.checked_out_by = staffRow.id;

      const { error: stayError } = await filterByOrganizationId(
        supabase
          .from('stays')
          .update(updatePayload)
          .eq('id', stay.id),
        orgId,
        superAdmin
      );

      if (stayError) throw stayError;

      if (stay.reservation_id) {
        const { error: reservationError } = await filterByOrganizationId(
          supabase
            .from('reservations')
            .update({ status: 'checked_out' })
            .eq('id', stay.reservation_id),
          orgId,
          superAdmin
        );

        if (reservationError) throw reservationError;
      }

      const { error: roomError } = await filterByOrganizationId(
        supabase
          .from('rooms')
          .update({ status: 'cleaning' })
          .eq('id', stay.rooms.id),
        orgId,
        superAdmin
      );

      if (roomError) throw roomError;

      fetchActiveStays();
    } catch (error: unknown) {
      const msg = error && typeof error === 'object' && 'message' in error
        ? String((error as { message?: string }).message)
        : 'Failed to check out guest';
      console.error('Error checking out:', error);
      alert(msg);
    } finally {
      setProcessingId(null);
    }
  };

  const calculateNights = (checkInDate: string): number => {
    const checkIn = new Date(checkInDate);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - checkIn.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  if (loading) {
    return (
      <div className="p-6 md:p-8">
        <div className="animate-pulse">
          <div className="h-8 bg-slate-200 rounded w-48 mb-8"></div>
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-32 bg-slate-200 rounded-xl"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8">
      <div className="mb-8">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-bold text-slate-900">Active Stays</h1>
          <PageNotes ariaLabel="Active stays help">
            <p>Monitor current guests and check-outs.</p>
          </PageNotes>
        </div>
      </div>

      <div className="space-y-4">
        {stays.map((stay) => (
          <div key={stay.id} className="bg-white rounded-xl border border-slate-200 p-6 hover:shadow-lg transition">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-3">
                  <div className="bg-green-100 p-2 rounded-lg">
                    <DoorOpen className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">
                      {stay.hotel_customers ? `${stay.hotel_customers.first_name} ${stay.hotel_customers.last_name}` : 'Unknown customer'}
                    </h3>
                    <p className="text-sm text-slate-500">{stay.hotel_customers?.email || 'No email'}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="text-slate-500">Room</p>
                    <p className="font-medium text-slate-900">{stay.rooms?.room_number || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Checked In</p>
                    <p className="font-medium text-slate-900">
                      {new Date(stay.actual_check_in).toLocaleDateString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500">Nights</p>
                    <p className="font-medium text-slate-900">{calculateNights(stay.actual_check_in)}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Status</p>
                    <p className="font-medium text-green-600">Active</p>
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setBillStay(stay)}
                  className="flex items-center gap-2 px-4 py-3 border border-slate-300 rounded-lg hover:bg-slate-50 transition whitespace-nowrap"
                >
                  <Printer className="w-5 h-5" />
                  Print Bill
                </button>
                <button
                  onClick={() => handleCheckOut(stay)}
                  disabled={processingId === stay.id}
                  className="app-btn-primary px-6 py-3 whitespace-nowrap disabled:cursor-not-allowed"
                >
                  <LogOut className="w-5 h-5" />
                  {processingId === stay.id ? 'Processing...' : 'Check Out'}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {billStay && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <GuestBill
              stay={billStay}
              onClose={() => setBillStay(null)}
            />
          </div>
        </div>
      )}

      {stays.length === 0 && (
        <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
          <DoorOpen className="w-16 h-16 text-slate-300 mx-auto mb-4" />
          <p className="text-slate-500 text-lg">No active stays</p>
          <p className="text-slate-400 text-sm mt-2">All rooms are currently vacant</p>
        </div>
      )}
    </div>
  );
}
