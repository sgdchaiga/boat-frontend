import React, { useState } from "react";
import { Eye, EyeOff, Loader2, AlertCircle, UserCircle, Landmark } from "lucide-react";

import { APP_NAME, APP_SHORT_NAME } from "@/constants/branding";
import { useAuth, type UserRole } from "@/contexts/AuthContext";

export const LoginPage: React.FC = () => {
  const localAuthEnabled = ["true", "1", "yes"].includes((import.meta.env.VITE_LOCAL_AUTH || "").trim().toLowerCase());

  const { signIn, signUp, pendingPasswordReset, resetPasswordForEmail, setNewPassword } = useAuth();

  const [mode, setMode] = useState<"login" | "signup">("login");
  const [showForgotForm, setShowForgotForm] = useState(false);
  const [forgotSuccess, setForgotSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [newPassword, setNewPasswordValue] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirmValue] = useState("");

  const [form, setForm] = useState({
    email: "",
    password: "",
    confirmPassword: "",
    fullName: "",
    role: "receptionist" as UserRole
  });

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await signIn(form.email, form.password);

    if (error) setError(error.message);

    setLoading(false);
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (form.password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (!form.fullName.trim()) {
      setError("Full name is required");
      return;
    }

    setLoading(true);

    const { error } = await signUp(
      form.email,
      form.password,
      form.fullName,
      form.role
    );

    if (error) setError(error.message);

    setLoading(false);
  };

  const resetForm = () => {
    setForm({
      email: "",
      password: "",
      confirmPassword: "",
      fullName: "",
      role: "receptionist"
    });

    setError(null);
    setShowPassword(false);
  };

  const switchMode = (newMode: "login" | "signup") => {
    setMode(newMode);
    setShowForgotForm(false);
    setForgotSuccess(false);
    resetForm();
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error: err } = await resetPasswordForEmail(form.email);
    setLoading(false);
    if (err) setError(err.message);
    else setForgotSuccess(true);
  };

  const handleSetNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      setError("Passwords do not match");
      return;
    }
    setLoading(true);
    const { error: err } = await setNewPassword(newPassword);
    setLoading(false);
    if (err) setError(err.message);
    else {
      setNewPasswordValue("");
      setNewPasswordConfirmValue("");
    }
  };

  const showSetPasswordForm = pendingPasswordReset;
  const showForgotPasswordForm = showForgotForm && !showSetPasswordForm;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">

      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">

        {/* Header */}

        <div className="bg-gradient-to-r from-slate-800 to-slate-900 p-6 text-white">

          <div className="flex items-center gap-3 mb-3">

            <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center">
              <Landmark size={20} />
            </div>

            <div>
              <h2 className="text-lg font-bold">{APP_SHORT_NAME}</h2>
              <p className="text-xs text-slate-300 leading-snug">
                {APP_NAME}
              </p>
            </div>

          </div>

          <p className="text-sm text-slate-300">
            {showSetPasswordForm
              ? "Set a new password"
              : showForgotPasswordForm
                ? "Reset your password"
                : mode === "login"
                  ? "Sign in to access your account"
                  : "Create a new staff account"}
          </p>
          {localAuthEnabled && (
            <p className="mt-2 text-xs text-emerald-200">
              Desktop local mode: accounts are stored on this computer and internet is optional.
            </p>
          )}

        </div>

        {/* Tabs - hide when forgot or set-password */}

        {!showForgotPasswordForm && !showSetPasswordForm && (
          <div className="flex border-b">
            <button
              onClick={() => switchMode("login")}
              className={`flex-1 py-3 text-sm font-medium border-b-2 ${
                mode === "login"
                  ? "border-emerald-500 text-emerald-600"
                  : "border-transparent text-slate-400"
              }`}
            >
              Sign In
            </button>
            <button
              onClick={() => switchMode("signup")}
              className={`flex-1 py-3 text-sm font-medium border-b-2 ${
                mode === "signup"
                  ? "border-emerald-500 text-emerald-600"
                  : "border-transparent text-slate-400"
              }`}
            >
              Create Account
            </button>
          </div>
        )}

        {/* Error */}

        {error && (
          <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg flex gap-2">

            <AlertCircle size={16} className="text-red-500" />

            <p className="text-sm text-red-700">{error}</p>

          </div>
        )}

        {/* Form */}

        {showSetPasswordForm ? (
          <form onSubmit={handleSetNewPassword} className="p-6 space-y-4">
            <div>
              <label className="text-xs font-medium text-slate-700">New password</label>
              <input
                type={showPassword ? "text" : "password"}
                required
                minLength={6}
                value={newPassword}
                onChange={(e) => setNewPasswordValue(e.target.value)}
                className="w-full mt-1 px-3 py-2 border rounded-lg text-sm"
                placeholder="At least 6 characters"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-700">Confirm new password</label>
              <input
                type={showPassword ? "text" : "password"}
                required
                value={newPasswordConfirm}
                onChange={(e) => setNewPasswordConfirmValue(e.target.value)}
                className="w-full mt-1 px-3 py-2 border rounded-lg text-sm"
                placeholder="Re-enter password"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-emerald-600 text-white rounded-lg"
            >
              {loading ? <Loader2 size={16} className="animate-spin mx-auto" /> : "Set password & sign in"}
            </button>
          </form>
        ) : showForgotPasswordForm ? (
          <form onSubmit={handleForgotPassword} className="p-6 space-y-4">
            {forgotSuccess ? (
              <>
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-800">
                  Check your email for a link to reset your password. You can close this and use the link from your inbox.
                </div>
                <button
                  type="button"
                  onClick={() => { setShowForgotForm(false); setForgotSuccess(false); setError(null); }}
                  className="w-full py-3 border border-slate-300 rounded-lg text-slate-700"
                >
                  Back to sign in
                </button>
              </>
            ) : (
              <>
                <div>
                  <label className="text-xs font-medium text-slate-700">Email</label>
                  <input
                    type="email"
                    required
                    value={form.email}
                    onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                    className="w-full mt-1 px-3 py-2 border rounded-lg text-sm"
                    placeholder="Enter your email"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 bg-emerald-600 text-white rounded-lg"
                >
                  {loading ? <Loader2 size={16} className="animate-spin mx-auto" /> : "Send reset link"}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowForgotForm(false); setError(null); resetForm(); }}
                  className="w-full py-2 text-slate-600 text-sm"
                >
                  Back to sign in
                </button>
              </>
            )}
          </form>
        ) : (
        <form
          onSubmit={mode === "login" ? handleLogin : handleSignup}
          className="p-6 space-y-4"
        >

          {mode === "signup" && (
            <div>

              <label className="text-xs font-medium text-slate-700">
                Full Name
              </label>

              <div className="relative">

                <UserCircle
                  size={16}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />

                <input
                  type="text"
                  required
                  value={form.fullName}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, fullName: e.target.value }))
                  }
                  className="w-full pl-10 pr-4 py-2 border rounded-lg text-sm"
                />

              </div>

            </div>
          )}

          {/* Email */}

          <div>

            <label className="text-xs font-medium text-slate-700">
              Email
            </label>

            <input
              type="email"
              required
              value={form.email}
              onChange={(e) =>
                setForm((p) => ({ ...p, email: e.target.value }))
              }
              className="w-full mt-1 px-3 py-2 border rounded-lg text-sm"
            />

          </div>

          {/* Password */}

          <div>

            <label className="text-xs font-medium text-slate-700">
              Password
            </label>

            <div className="relative">

              <input
                type={showPassword ? "text" : "password"}
                required
                value={form.password}
                onChange={(e) =>
                  setForm((p) => ({ ...p, password: e.target.value }))
                }
                className="w-full mt-1 px-3 py-2 border rounded-lg text-sm"
              />

              <button
                type="button"
                onClick={() => setShowPassword((p) => !p)}
                className="absolute right-3 top-2 text-slate-400"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>

            </div>

          </div>

          {/* Confirm Password */}

          {mode === "signup" && (
            <div>

              <label className="text-xs font-medium text-slate-700">
                Confirm Password
              </label>

              <input
                type={showPassword ? "text" : "password"}
                value={form.confirmPassword}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    confirmPassword: e.target.value
                  }))
                }
                className="w-full mt-1 px-3 py-2 border rounded-lg text-sm"
              />

            </div>
          )}

          {/* Submit */}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-emerald-600 text-white rounded-lg"
          >
            {loading ? (
              <Loader2 size={16} className="animate-spin mx-auto" />
            ) : mode === "login" ? (
              "Sign In"
            ) : (
              "Create Account"
            )}
          </button>

          {mode === "login" && (
            <button
              type="button"
              onClick={() => { setShowForgotForm(true); setError(null); }}
              className="w-full py-2 text-sm text-slate-500 hover:text-emerald-600"
            >
              Forgot password?
            </button>
          )}

        </form>
        )}

      </div>
    </div>
  );
};

