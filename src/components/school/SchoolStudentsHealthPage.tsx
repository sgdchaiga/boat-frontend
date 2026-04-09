import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export function StudentsHealthPage() {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const { data } = await supabase
      .from("students")
      .select("*")
      .eq("has_health_issue", true);

    setRows(data || []);
  };

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold">Students with Health Issues</h1>

      <table className="w-full mt-4 border">
        <thead>
          <tr>
            <th>Name</th>
            <th>Class</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r: any) => (
            <tr key={r.id}>
              <td>{r.first_name} {r.last_name}</td>
              <td>{r.class_name}</td>
              <td>{r.notes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}