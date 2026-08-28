import { useState } from "react";

const API_BASE = "https://smart-daily-planner-production.up.railway.app";

export default function Login({ onLoggedIn }) {
  const [mode, setMode] = useState("login"); // 'login' | 'signup'
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/signup";
      const body =
        mode === "login" ? { email, password } : { name, email, password };

      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!data.success) {
        throw new Error(data.error || "Something went wrong.");
      }

      // Persist so the person stays logged in across page refreshes
      localStorage.setItem("smartPlannerToken", data.token);
      localStorage.setItem("smartPlannerUser", JSON.stringify(data.user));

      onLoggedIn(data.token, data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>Smart Daily Planner</h1>
        <p style={styles.subtitle}>
          {mode === "login" ? "Welcome back — log in to see your plans." : "Create an account to get started."}
        </p>

        <div style={styles.toggle}>
          <button
            type="button"
            onClick={() => { setMode("login"); setError(""); }}
            style={{ ...styles.toggleBtn, ...(mode === "login" ? styles.toggleActive : {}) }}
          >
            Log in
          </button>
          <button
            type="button"
            onClick={() => { setMode("signup"); setError(""); }}
            style={{ ...styles.toggleBtn, ...(mode === "signup" ? styles.toggleActive : {}) }}
          >
            Sign up
          </button>
        </div>

        <form onSubmit={handleSubmit} style={styles.form}>
          {mode === "signup" && (
            <input
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={styles.input}
              required
            />
          )}
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={styles.input}
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={styles.input}
            required
            minLength={6}
          />

          {error && <p style={styles.error}>{error}</p>}

          <button type="submit" disabled={loading} style={styles.submitBtn}>
            {loading ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
          </button>
        </form>
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "linear-gradient(160deg, #FFE8D6 0%, #FFD9E4 30%, #D6EEFF 70%, #C9F0E4 100%)",
    fontFamily: "'Nunito Sans', system-ui, sans-serif",
    padding: 20,
  },
  card: {
    background: "rgba(255,255,255,0.85)",
    backdropFilter: "blur(8px)",
    borderRadius: 20,
    padding: 34,
    width: "100%",
    maxWidth: 380,
    boxShadow: "0 20px 50px rgba(56, 189, 248, 0.18)",
  },
  title: {
    fontFamily: "'Fredoka', system-ui, sans-serif",
    fontSize: 24,
    fontWeight: 700,
    margin: "0 0 6px",
    color: "#2B3245",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 13.5,
    color: "#6B7280",
    textAlign: "center",
    margin: "0 0 22px",
  },
  toggle: {
    display: "flex",
    background: "#F3F4F6",
    borderRadius: 10,
    padding: 3,
    marginBottom: 20,
  },
  toggleBtn: {
    flex: 1,
    border: "none",
    background: "transparent",
    padding: "9px",
    fontSize: 13.5,
    fontWeight: 700,
    borderRadius: 8,
    cursor: "pointer",
    color: "#8A93A6",
  },
  toggleActive: {
    background: "#fff",
    color: "#2B3245",
    boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
  },
  form: { display: "flex", flexDirection: "column", gap: 12 },
  input: {
    padding: "12px 14px",
    borderRadius: 10,
    border: "1.5px solid #E5E7EB",
    fontSize: 14.5,
    outline: "none",
    fontFamily: "inherit",
  },
  error: {
    color: "#DC2626",
    fontSize: 13,
    fontWeight: 600,
    margin: 0,
  },
  submitBtn: {
    marginTop: 6,
    padding: "13px",
    background: "linear-gradient(120deg, #FF9F68 0%, #38BDF8 100%)",
    color: "#fff",
    border: "none",
    borderRadius: 12,
    fontFamily: "'Fredoka', system-ui, sans-serif",
    fontSize: 15.5,
    fontWeight: 600,
    cursor: "pointer",
  },
};