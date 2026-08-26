import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-this";
const JWT_EXPIRY = "7d"; // how long a login stays valid

/**
 * Creates the auth router. Needs the pg Pool passed in so it can query
 * the same database connection the rest of the app uses.
 */
function createAuthRouter(pool) {
  const router = express.Router();

  // ---- Signup ----
  router.post("/signup", async (req, res) => {
    try {
      const { name, email, password } = req.body;

      if (!name || !email || !password) {
        return res.status(400).json({ success: false, error: "Name, email, and password are all required." });
      }
      if (password.length < 6) {
        return res.status(400).json({ success: false, error: "Password must be at least 6 characters." });
      }

      const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
      if (existing.rows.length > 0) {
        return res.status(409).json({ success: false, error: "An account with this email already exists." });
      }

      // bcrypt hashing — never store the raw password, only this hash
      const passwordHash = await bcrypt.hash(password, 10);

      const result = await pool.query(
        `INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email`,
        [name, email, passwordHash]
      );
      const user = result.rows[0];

      const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRY });

      res.json({ success: true, token, user: { id: user.id, name: user.name, email: user.email } });
    } catch (err) {
      console.error("❌ SIGNUP ERROR:", err);
      res.status(500).json({ success: false, error: "Could not create account. Please try again." });
    }
  });

  // ---- Login ----
  router.post("/login", async (req, res) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ success: false, error: "Email and password are required." });
      }

      const result = await pool.query(
        "SELECT id, name, email, password_hash FROM users WHERE email = $1",
        [email]
      );
      const user = result.rows[0];

      // Deliberately vague error message — don't reveal whether the email
      // exists or the password was wrong; both cases say the same thing.
      if (!user) {
        return res.status(401).json({ success: false, error: "Invalid email or password." });
      }

      const passwordMatches = await bcrypt.compare(password, user.password_hash);
      if (!passwordMatches) {
        return res.status(401).json({ success: false, error: "Invalid email or password." });
      }

      const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRY });

      res.json({ success: true, token, user: { id: user.id, name: user.name, email: user.email } });
    } catch (err) {
      console.error("❌ LOGIN ERROR:", err);
      res.status(500).json({ success: false, error: "Could not log in. Please try again." });
    }
  });

  return router;
}

/**
 * Middleware that checks for a valid JWT in the Authorization header
 * (format: "Bearer <token>"), and attaches req.userId if valid.
 * Any route using this middleware requires the person to be logged in.
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, error: "Not logged in." });
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: "Session expired. Please log in again." });
  }
}

export { createAuthRouter, requireAuth, JWT_SECRET };