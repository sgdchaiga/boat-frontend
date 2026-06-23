import { useEffect, useState } from 'react';
import { Sparkles, Plus, X, ClipboardList, BedDouble, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Database } from '../lib/database.types';
import { PageNotes } from './common/PageNotes';
import { useAuth } from '../contexts/AuthContext';
import { filterByOrganizationId } from '../lib/supabaseOrgFilter';

type HousekeepingTask = Database['public']['Tables']['housekeeping_tasks']['Row'] & {
  rooms: { room_number: string } | null;
  staff: { full_name: string } | null;
};

type AttendantSheetEntry = {
  id: string;
  service_date: string;
  room_id: string;
  attendant_id: string | null;
  bed_sheets: number;
  pillow_cases: number;
  bath_towels: number;
  hand_towels: number;
  bath_mats: number;
  notes: string | null;
  created_at: string;
  rooms: { room_number: string } | null;
  staff: { full_name: string } | null;
};

const today = () => {
  const value = new Date();
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export function HousekeepingPage() {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;
  const [tasks, setTasks] = useState<HousekeepingTask[]>([]);
  const [activeTab, setActiveTab] = useState<'tasks' | 'attendant'>('tasks');
  const [sheetEntries, setSheetEntries] = useState<AttendantSheetEntry[]>([]);
  const [sheetDate, setSheetDate] = useState(today());
  const [sheetLoading, setSheetLoading] = useState(false);
  const [showSheetModal, setShowSheetModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [rooms, setRooms] = useState<{ id: string; room_number: string }[]>([]);
  const [staffList, setStaffList] = useState<{ id: string; full_name: string }[]>([]);
  const [newRoomId, setNewRoomId] = useState('');
  const [newTaskType, setNewTaskType] = useState<'cleaning' | 'maintenance' | 'inspection'>('cleaning');
  const [newPriority, setNewPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium');
  const [newNotes, setNewNotes] = useState('');
  const [newAssignedTo, setNewAssignedTo] = useState('');
  const [saving, setSaving] = useState(false);
  const [entryRoomId, setEntryRoomId] = useState('');
  const [entryAttendantId, setEntryAttendantId] = useState('');
  const [entryNotes, setEntryNotes] = useState('');
  const [linenUsage, setLinenUsage] = useState({
    bed_sheets: 0,
    pillow_cases: 0,
    bath_towels: 0,
    hand_towels: 0,
    bath_mats: 0,
  });

  useEffect(() => {
    fetchTasks();
  }, [orgId, superAdmin]);

  useEffect(() => {
    if (activeTab === 'attendant') fetchSheetEntries();
  }, [activeTab, sheetDate, orgId, superAdmin]);

  useEffect(() => {
    if (!showAddModal && !showSheetModal) return;
    let cancelled = false;
    (async () => {
      if (!orgId && !superAdmin) {
        setRooms([]);
        setStaffList([]);
        return;
      }
      const [roomsR, staffR] = await Promise.all([
        filterByOrganizationId(
          supabase.from('rooms').select('id, room_number').order('room_number'),
          orgId,
          superAdmin
        ),
        filterByOrganizationId(
          supabase.from('staff').select('id, full_name').eq('is_active', true).order('full_name'),
          orgId,
          superAdmin
        ),
      ]);
      if (cancelled) return;
      setRooms(roomsR.data || []);
      setStaffList(staffR.data || []);
    })();
    return () => {
      cancelled = true;
    };
  }, [showAddModal, showSheetModal, orgId, superAdmin]);

  const fetchTasks = async () => {
    try {
      if (!orgId && !superAdmin) {
        setTasks([]);
        return;
      }
      const { data, error } = await filterByOrganizationId(
        supabase
          .from('housekeeping_tasks')
          .select('*, rooms(room_number), staff(full_name)')
          .order('created_at', { ascending: false }),
        orgId,
        superAdmin
      );

      if (error) throw error;
      setTasks(data || []);
    } catch (error) {
      console.error('Error fetching tasks:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchSheetEntries = async () => {
    setSheetLoading(true);
    try {
      if (!orgId && !superAdmin) {
        setSheetEntries([]);
        return;
      }
      const { data, error } = await filterByOrganizationId(
        supabase
          .from('housekeeping_attendant_sheets')
          .select('*, rooms(room_number), staff:attendant_id(full_name)')
          .eq('service_date', sheetDate)
          .order('created_at', { ascending: false }),
        orgId,
        superAdmin
      );
      if (error) throw error;
      setSheetEntries((data || []) as AttendantSheetEntry[]);
    } catch (error) {
      console.error('Error fetching room attendant sheet:', error);
    } finally {
      setSheetLoading(false);
    }
  };

  const resetSheetForm = () => {
    setEntryRoomId('');
    setEntryAttendantId('');
    setEntryNotes('');
    setLinenUsage({ bed_sheets: 0, pillow_cases: 0, bath_towels: 0, hand_towels: 0, bath_mats: 0 });
  };

  const handleCreateSheetEntry = async () => {
    if (!entryRoomId || !entryAttendantId) {
      alert('Please select both a room and an attendant.');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from('housekeeping_attendant_sheets').insert({
        organization_id: orgId ?? null,
        service_date: sheetDate,
        room_id: entryRoomId,
        attendant_id: entryAttendantId,
        ...linenUsage,
        notes: entryNotes.trim() || null,
      });
      if (error) throw error;
      setShowSheetModal(false);
      resetSheetForm();
      fetchSheetEntries();
    } catch (error) {
      console.error('Error recording room attendant sheet:', error);
      alert('Failed to save the attendant sheet entry: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setSaving(false);
    }
  };

  const deleteSheetEntry = async (entryId: string) => {
    if (!confirm('Remove this room from the attendant sheet?')) return;
    try {
      const { error } = await filterByOrganizationId(
        supabase.from('housekeeping_attendant_sheets').delete().eq('id', entryId),
        orgId,
        superAdmin
      );
      if (error) throw error;
      fetchSheetEntries();
    } catch (error) {
      console.error('Error deleting attendant sheet entry:', error);
      alert('Failed to remove the entry.');
    }
  };

  const handleCreateTask = async () => {
    if (!newRoomId) {
      alert('Please select a room.');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from('housekeeping_tasks').insert({
        room_id: newRoomId,
        task_type: newTaskType,
        priority: newPriority,
        notes: newNotes.trim() || null,
        assigned_to: newAssignedTo || null,
        organization_id: orgId ?? null,
      });
      if (error) throw error;
      setShowAddModal(false);
      setNewRoomId('');
      setNewTaskType('cleaning');
      setNewPriority('medium');
      setNewNotes('');
      setNewAssignedTo('');
      fetchTasks();
    } catch (err) {
      console.error('Error creating task:', err);
      alert('Failed to create task: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  };

  const updateTaskStatus = async (taskId: string, newStatus: string) => {
    try {
      const updates: { status: string; completed_at?: string } = { status: newStatus };
      if (newStatus === 'completed') {
        updates.completed_at = new Date().toISOString();
      }

      const { error } = await filterByOrganizationId(
        supabase
          .from('housekeeping_tasks')
          .update(updates)
          .eq('id', taskId),
        orgId,
        superAdmin
      );

      if (error) throw error;
      fetchTasks();
    } catch (error) {
      console.error('Error updating task:', error);
    }
  };

  const filteredTasks = tasks.filter((task) => {
    const matchesStatus = filterStatus === 'all' || task.status === filterStatus;
    const matchesPriority = filterPriority === 'all' || task.priority === filterPriority;
    return matchesStatus && matchesPriority;
  });

  const usageTotals = sheetEntries.reduce(
    (totals, entry) => ({
      bed_sheets: totals.bed_sheets + entry.bed_sheets,
      pillow_cases: totals.pillow_cases + entry.pillow_cases,
      bath_towels: totals.bath_towels + entry.bath_towels,
      hand_towels: totals.hand_towels + entry.hand_towels,
      bath_mats: totals.bath_mats + entry.bath_mats,
    }),
    { bed_sheets: 0, pillow_cases: 0, bath_towels: 0, hand_towels: 0, bath_mats: 0 }
  );

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'in_progress': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'completed': return 'bg-green-100 text-green-800 border-green-200';
      default: return 'bg-slate-100 text-slate-800 border-slate-200';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent': return 'bg-red-100 text-red-800';
      case 'high': return 'bg-orange-100 text-orange-800';
      case 'medium': return 'bg-amber-100 text-amber-800';
      case 'low': return 'bg-slate-100 text-slate-800';
      default: return 'bg-slate-100 text-slate-800';
    }
  };

  const getTaskTypeIcon = (type: string) => {
    return type.charAt(0).toUpperCase() + type.slice(1);
  };

  if (loading) {
    return (
      <div className="p-6 md:p-8">
        <div className="animate-pulse">
          <div className="h-8 bg-slate-200 rounded w-48 mb-8"></div>
          <div className="space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-24 bg-slate-200 rounded-xl"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold text-slate-900">Housekeeping</h1>
            <PageNotes ariaLabel="Housekeeping help">
              <p>Manage room cleaning and maintenance tasks.</p>
            </PageNotes>
          </div>
        </div>
        <button
          type="button"
          onClick={() => activeTab === 'tasks' ? setShowAddModal(true) : setShowSheetModal(true)}
          className="bg-brand-700 hover:bg-brand-800 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition cursor-pointer"
        >
          <Plus className="w-5 h-5" />
          <span className="hidden sm:inline">{activeTab === 'tasks' ? 'New Task' : 'Record Room'}</span>
        </button>
      </div>

      <div className="flex gap-2 border-b border-slate-200 mb-6">
        <button
          type="button"
          onClick={() => setActiveTab('tasks')}
          className={`px-4 py-3 text-sm font-semibold border-b-2 transition ${activeTab === 'tasks' ? 'border-brand-700 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
        >
          Housekeeping Tasks
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('attendant')}
          className={`px-4 py-3 text-sm font-semibold border-b-2 transition flex items-center gap-2 ${activeTab === 'attendant' ? 'border-brand-700 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
        >
          <ClipboardList className="w-4 h-4" /> Room Attendant Sheet
        </button>
      </div>

      {activeTab === 'tasks' ? (
        <>

      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6">
        <div className="flex flex-col sm:flex-row gap-4">
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-800 focus:border-transparent outline-none"
          >
            <option value="all">All Status</option>
            <option value="pending">Pending</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
          </select>
          <select
            value={filterPriority}
            onChange={(e) => setFilterPriority(e.target.value)}
            className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-800 focus:border-transparent outline-none"
          >
            <option value="all">All Priority</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
      </div>

      <div className="space-y-4">
        {filteredTasks.map((task) => (
          <div key={task.id} className="bg-white rounded-xl border border-slate-200 p-6 hover:shadow-lg transition">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-start gap-3 mb-3">
                  <div className="bg-pink-100 p-2 rounded-lg">
                    <Sparkles className="w-5 h-5 text-pink-600" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-lg font-bold text-slate-900">Room {task.rooms?.room_number || 'N/A'}</h3>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getPriorityColor(task.priority)}`}>
                        {task.priority}
                      </span>
                    </div>
                    <p className="text-sm text-slate-500">{getTaskTypeIcon(task.task_type)}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                  <div>
                    <p className="text-slate-500">Assigned To</p>
                    <p className="font-medium text-slate-900">{task.staff?.full_name || 'Unassigned'}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Created</p>
                    <p className="font-medium text-slate-900">{new Date(task.created_at).toLocaleDateString()}</p>
                  </div>
                  {task.completed_at && (
                    <div>
                      <p className="text-slate-500">Completed</p>
                      <p className="font-medium text-slate-900">{new Date(task.completed_at).toLocaleDateString()}</p>
                    </div>
                  )}
                </div>
                {task.notes && (
                  <div className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                    <p className="text-sm text-slate-700">{task.notes}</p>
                  </div>
                )}
              </div>
              <div>
                <select
                  value={task.status}
                  onChange={(e) => updateTaskStatus(task.id, e.target.value)}
                  className={`px-4 py-2 rounded-lg border font-medium text-sm ${getStatusColor(task.status)}`}
                >
                  <option value="pending">Pending</option>
                  <option value="in_progress">In Progress</option>
                  <option value="completed">Completed</option>
                </select>
              </div>
            </div>
          </div>
        ))}
      </div>

      {filteredTasks.length === 0 && (
        <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
          <Sparkles className="w-16 h-16 text-slate-300 mx-auto mb-4" />
          <p className="text-slate-500 text-lg">No housekeeping tasks</p>
        </div>
      )}
        </>
      ) : (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col sm:flex-row sm:items-end gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Sheet date</label>
              <input type="date" value={sheetDate} onChange={(e) => setSheetDate(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2" />
            </div>
            <p className="text-sm text-slate-500 sm:pb-2">{sheetEntries.length} room{sheetEntries.length === 1 ? '' : 's'} recorded</p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              ['Bed sheets', usageTotals.bed_sheets],
              ['Pillow cases', usageTotals.pillow_cases],
              ['Bath towels', usageTotals.bath_towels],
              ['Hand towels', usageTotals.hand_towels],
              ['Bath mats', usageTotals.bath_mats],
            ].map(([label, value]) => (
              <div key={String(label)} className="bg-white rounded-xl border border-slate-200 p-4">
                <p className="text-xs text-slate-500">{label}</p>
                <p className="text-2xl font-bold text-slate-900 mt-1">{value}</p>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  {['Room', 'Attendant', 'Bed sheets', 'Pillow cases', 'Bath towels', 'Hand towels', 'Bath mats', 'Notes', ''].map((heading) => (
                    <th key={heading} className="px-4 py-3 text-left font-semibold">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sheetEntries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-semibold text-slate-900">Room {entry.rooms?.room_number || 'N/A'}</td>
                    <td className="px-4 py-3 text-slate-700">{entry.staff?.full_name || 'Unassigned'}</td>
                    <td className="px-4 py-3">{entry.bed_sheets}</td>
                    <td className="px-4 py-3">{entry.pillow_cases}</td>
                    <td className="px-4 py-3">{entry.bath_towels}</td>
                    <td className="px-4 py-3">{entry.hand_towels}</td>
                    <td className="px-4 py-3">{entry.bath_mats}</td>
                    <td className="px-4 py-3 text-slate-500 max-w-xs truncate">{entry.notes || '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <button type="button" onClick={() => deleteSheetEntry(entry.id)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg" aria-label="Remove entry">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!sheetLoading && sheetEntries.length === 0 && (
              <div className="text-center py-12">
                <BedDouble className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-600 font-medium">No rooms recorded for this date</p>
                <p className="text-sm text-slate-400">Use Record Room to start the attendant sheet.</p>
              </div>
            )}
            {sheetLoading && <div className="text-center py-10 text-slate-500">Loading attendant sheet…</div>}
          </div>
        </div>
      )}

      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => !saving && setShowAddModal(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-slate-900">New Task</h2>
              <button type="button" onClick={() => !saving && setShowAddModal(false)} className="p-1 hover:bg-slate-100 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Room *</label>
                <select
                  value={newRoomId}
                  onChange={(e) => setNewRoomId(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2"
                  required
                >
                  <option value="">Select room</option>
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>Room {r.room_number}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Task type</label>
                <select
                  value={newTaskType}
                  onChange={(e) => setNewTaskType(e.target.value as 'cleaning' | 'maintenance' | 'inspection')}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2"
                >
                  <option value="cleaning">Cleaning</option>
                  <option value="maintenance">Maintenance</option>
                  <option value="inspection">Inspection</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Priority</label>
                <select
                  value={newPriority}
                  onChange={(e) => setNewPriority(e.target.value as 'low' | 'medium' | 'high' | 'urgent')}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Assigned to</label>
                <select
                  value={newAssignedTo}
                  onChange={(e) => setNewAssignedTo(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2"
                >
                  <option value="">Unassigned</option>
                  {staffList.map((s) => (
                    <option key={s.id} value={s.id}>{s.full_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                <textarea
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  rows={3}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2"
                  placeholder="Optional notes"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button
                type="button"
                onClick={handleCreateTask}
                disabled={saving}
                className="app-btn-primary flex-1 disabled:cursor-not-allowed"
              >
                {saving ? 'Creating…' : 'Create Task'}
              </button>
              <button
                type="button"
                onClick={() => !saving && setShowAddModal(false)}
                className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showSheetModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => !saving && setShowSheetModal(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Record Room Service</h2>
                <p className="text-sm text-slate-500">{new Date(`${sheetDate}T00:00:00`).toLocaleDateString()}</p>
              </div>
              <button type="button" onClick={() => !saving && setShowSheetModal(false)} className="p-1 hover:bg-slate-100 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Room *</label>
                <select value={entryRoomId} onChange={(e) => setEntryRoomId(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2">
                  <option value="">Select room</option>
                  {rooms.map((room) => <option key={room.id} value={room.id}>Room {room.room_number}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Room attendant *</label>
                <select value={entryAttendantId} onChange={(e) => setEntryAttendantId(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2">
                  <option value="">Select attendant</option>
                  {staffList.map((staff) => <option key={staff.id} value={staff.id}>{staff.full_name}</option>)}
                </select>
              </div>
            </div>

            <div className="mt-6">
              <h3 className="font-semibold text-slate-900 mb-1">Used linens and towels</h3>
              <p className="text-sm text-slate-500 mb-4">Enter the number of clean items placed in the room.</p>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {([
                  ['bed_sheets', 'Bed sheets'],
                  ['pillow_cases', 'Pillow cases'],
                  ['bath_towels', 'Bath towels'],
                  ['hand_towels', 'Hand towels'],
                  ['bath_mats', 'Bath mats'],
                ] as const).map(([key, label]) => (
                  <div key={key}>
                    <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={linenUsage[key]}
                      onChange={(e) => setLinenUsage((current) => ({ ...current, [key]: Math.max(0, Number.parseInt(e.target.value, 10) || 0) }))}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-5">
              <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
              <textarea value={entryNotes} onChange={(e) => setEntryNotes(e.target.value)} rows={3} className="w-full border border-slate-300 rounded-lg px-3 py-2" placeholder="Lost property, damage, minibar, maintenance issue…" />
            </div>
            <div className="flex gap-2 mt-6">
              <button type="button" onClick={handleCreateSheetEntry} disabled={saving} className="app-btn-primary flex-1 disabled:cursor-not-allowed">
                {saving ? 'Saving…' : 'Save Entry'}
              </button>
              <button type="button" onClick={() => !saving && setShowSheetModal(false)} className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
