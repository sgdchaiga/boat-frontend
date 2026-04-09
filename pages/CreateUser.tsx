import { useState } from "react";
import { useAuth, UserRole } from "@/contexts/AuthContext";

export default function CreateUser() {
  const { signUp } = useAuth();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("teller");
  const [message, setMessage] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    setMessage("Creating user...");

    const { error } = await signUp(email, password, fullName, role);

    if (error) {
      setMessage(error);
    } else {
      setMessage("User created successfully");

      setFullName("");
      setEmail("");
      setPassword("");
      setRole("teller");
    }
  };

  return (
    <div className="max-w-md mx-auto p-6">
      <h2 className="text-xl font-bold mb-4">Create User</h2>

      <form onSubmit={handleSubmit} className="space-y-4">

        <div>
          <label className="block mb-1">Full Name</label>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="border p-2 w-full rounded"
            required
          />
        </div>

        <div>
          <label className="block mb-1">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="border p-2 w-full rounded"
            required
          />
        </div>

        <div>
          <label className="block mb-1">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="border p-2 w-full rounded"
            required
          />
        </div>

        <div>
          <label className="block mb-1">Role</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as UserRole)}
            className="border p-2 w-full rounded"
          >
            <option value="admin">Administrator</option>
            <option value="manager">Manager</option>
            <option value="teller">Teller</option>
          </select>
        </div>

        <button
          type="submit"
          className="bg-blue-600 text-white w-full p-2 rounded"
        >
          Create User
        </button>

      </form>

      {message && (
        <p className="mt-4 text-sm text-center">{message}</p>
      )}
    </div>
  );
}