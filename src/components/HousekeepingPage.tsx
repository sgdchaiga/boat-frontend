import { useEffect, useState } from 'react';
import { Sparkles, Plus, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Database } from '../lib/database.types';
import { PageNotes } from './common/PageNotes';

type HousekeepingTask = Database['public']['Tables']['housekeeping_tasks']['Row'] & {
  rooms: { room_number: string } | null;
  staff: { full_name: string } | null;
};

export function HousekeepingPage() {
  const [tasks, setTasks] = useState<HousekeepingTask[]>([]);
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

  useEffect(() => {
    fetchTasks();
  }, []);

  useEffect(() => {
    if (!showAddModal) return;
    let cancelled = false;
    (async () => {
      const [roomsR, staffR] = await Promise.all([
        supabase.from('rooms').select('id, room_number').order('room_number'),
        supabase.from('staff').select('id, full_name').eq('is_active', true).order('full_name'),
      ]);
      if (cancelled) return;
      setRooms(roomsR.data || []);
      setStaffList(staffR.data || []);
    })();
    return () => {
      cancelled = true;
    };
  }, [showAddModal]);

  const fetchTasks = async () => {
    try {
      const { data, error } = await supabase
        .from('housekeeping_tasks')
        .select('*, rooms(room_number), staff(full_name)')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setTasks(data || []);
    } catch (error) {
      console.error('Error fetching tasks:', error);
    } finally {
      setLoading(false);
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

      const { error } = await supabase
        .from('housekeeping_tasks')
        .update(updates)
        .eq('id', taskId);

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
          onClick={() => setShowAddModal(true)}
          className="bg-brand-700 hover:bg-brand-800 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition cursor-pointer"
        >
          <Plus className="w-5 h-5" />
          <span className="hidden sm:inline">New Task</span>
        </button>
      </div>

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
    </div>
  );
}
