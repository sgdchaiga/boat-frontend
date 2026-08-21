import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, BookOpen, GraduationCap, HeartPulse, MessageSquare, School, UserPlus, Users, UsersRound } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { SCHOOL_PAGE } from "@/lib/schoolPages";

type Props = { onNavigate: (page: string, state?: Record<string, unknown>) => void };
type Counts = { students: number; classes: number; streams: number; teachers: number; staff: number; healthAlerts: number };
const initialCounts: Counts = { students: 0, classes: 0, streams: 0, teachers: 0, staff: 0, healthAlerts: 0 };

export function SchoolOperationsOverviewPage({ onNavigate }: Props) {
  const { user } = useAuth();
  const [counts, setCounts] = useState(initialCounts);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const orgId = user?.organization_id;
      if (!orgId) { setLoading(false); return; }
      const [students, classes, streams, teachers, staff, health] = await Promise.all([
        supabase.from("students").select("id", { count: "exact", head: true }).eq("organization_id", orgId).neq("status", "left"),
        supabase.from("classes").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("is_active", true),
        supabase.from("streams").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("is_active", true),
        supabase.from("teachers").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("is_active", true).eq("staff_type", "Teaching"),
        supabase.from("teachers").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("is_active", true),
        supabase.from("students").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("has_health_issue", true).neq("status", "left"),
      ]);
      if (cancelled) return;
      setCounts({ students: students.count || 0, classes: classes.count || 0, streams: streams.count || 0, teachers: teachers.count || 0, staff: staff.count || 0, healthAlerts: health.count || 0 });
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user?.organization_id]);

  const cards = [
    { label: "Active Students", value: counts.students, page: SCHOOL_PAGE.studentsList, icon: GraduationCap, tone: "bg-indigo-50 text-indigo-700" },
    { label: "Classes", value: counts.classes, page: SCHOOL_PAGE.classes, icon: School, tone: "bg-sky-50 text-sky-700" },
    { label: "Streams", value: counts.streams, page: SCHOOL_PAGE.classes, icon: BookOpen, tone: "bg-violet-50 text-violet-700" },
    { label: "Teaching Staff", value: counts.teachers, page: SCHOOL_PAGE.teachers, icon: UsersRound, tone: "bg-emerald-50 text-emerald-700" },
    { label: "All Staff", value: counts.staff, page: SCHOOL_PAGE.teachers, icon: Users, tone: "bg-slate-100 text-slate-700" },
    { label: "Health Alerts", value: counts.healthAlerts, page: SCHOOL_PAGE.healthIssues, icon: HeartPulse, tone: "bg-rose-50 text-rose-700" },
  ];
  const actions = [
    { label: "Add Student", detail: "Create an admission record", page: SCHOOL_PAGE.students, icon: UserPlus },
    { label: "Add Staff Member", detail: "Use the shared staff directory", page: SCHOOL_PAGE.teachers, icon: Users },
    { label: "Create Class or Stream", detail: "Maintain the academic structure", page: SCHOOL_PAGE.classes, icon: School },
    { label: "Assign Teacher", detail: "Link teaching staff to academic work", page: SCHOOL_PAGE.teachers, icon: BookOpen },
    { label: "Send Announcement", detail: "Open school communications", page: "communications", icon: MessageSquare },
  ];

  return <div className="mx-auto max-w-7xl space-y-6 p-6 lg:p-8">
    <header><p className="text-xs font-bold uppercase tracking-wider text-indigo-600">School administration</p><h1 className="mt-1 text-3xl font-bold text-slate-900">School Operations</h1><p className="mt-1 text-sm text-slate-600">Manage students, academic structures, staff assignments and daily school administration.</p></header>
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6" aria-label="School operations summary">
      {cards.map(({ label, value, page, icon: Icon, tone }) => <button key={label} type="button" onClick={() => onNavigate(page)} className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-indigo-300 hover:shadow-md"><span className={`inline-flex rounded-lg p-2 ${tone}`}><Icon className="h-4 w-4" /></span><p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-2xl font-bold text-slate-900">{loading ? "—" : value.toLocaleString()}</p></button>)}
    </section>
    <section><div className="mb-3"><h2 className="text-lg font-bold text-slate-900">Quick actions</h2><p className="text-sm text-slate-500">Start the school’s most common administrative tasks.</p></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{actions.map(({ label, detail, page, icon: Icon }) => <button key={label} type="button" onClick={() => onNavigate(page)} className="group rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm hover:border-indigo-300 hover:shadow-md"><Icon className="h-5 w-5 text-indigo-600" /><p className="mt-3 font-bold text-slate-900">{label}</p><p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p><ArrowRight className="mt-3 h-4 w-4 text-indigo-600 transition group-hover:translate-x-1" /></button>)}</div></section>
    <section className="grid gap-4 lg:grid-cols-2"><button type="button" onClick={() => onNavigate(SCHOOL_PAGE.healthIssues)} className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-left"><div className="flex items-center justify-between"><div><h2 className="font-bold text-slate-900">Students requiring attention</h2><p className="mt-1 text-sm text-slate-600">Review health alerts and incomplete student information.</p></div><AlertTriangle className="h-5 w-5 text-amber-600" /></div><p className="mt-4 text-sm font-semibold text-amber-800">Open health information <ArrowRight className="ml-1 inline h-4 w-4" /></p></button><button type="button" onClick={() => onNavigate(SCHOOL_PAGE.teachers)} className="rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm"><div className="flex items-center justify-between"><div><h2 className="font-bold text-slate-900">Teaching assignments</h2><p className="mt-1 text-sm text-slate-600">Review teaching staff and their academic responsibilities.</p></div><UsersRound className="h-5 w-5 text-indigo-600" /></div><p className="mt-4 text-sm font-semibold text-indigo-700">Manage assignments <ArrowRight className="ml-1 inline h-4 w-4" /></p></button></section>
  </div>;
}
