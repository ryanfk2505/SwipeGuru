import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import cors from "cors";
import cookieParser from "cookie-parser";
import db from "./src/db";
import { hashPassword, comparePassword, encryptData, decryptData } from "./src/security";

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));
  app.use(cookieParser());

  // API Endpoints
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });
  
  // Auth
  app.post("/api/login", (req, res) => {
    const { email, password } = req.body;
    try {
      // Find user first to verify hashed password safely
      const dbUser = db.prepare("SELECT password FROM users WHERE email = ?").get(email) as { password?: string } | undefined;
      
      if (!dbUser || !comparePassword(password, dbUser.password || "")) {
        return res.status(401).json({ success: false, message: "Email atau password salah." });
      }

      const user = db.prepare(`
        SELECT u.id, u.email, u.full_name, u.role,
          COALESCE(gp.bio, mp.bio) as bio,
          gp.tarif, gp.session_duration, gp.kampus, gp.gender, gp.lokasi,
          gp.status,
          COALESCE(gp.avatar_url, mp.avatar_url) as avatar_url,
          (SELECT AVG(rating) FROM reviews WHERE reviewee_id = u.id AND status = 'approved') as avg_rating,
          (SELECT COUNT(*) FROM reviews WHERE reviewee_id = u.id AND status = 'approved') as review_count
        FROM users u 
        LEFT JOIN guru_profiles gp ON u.id = gp.user_id
        LEFT JOIN murid_profiles mp ON u.id = mp.user_id
        WHERE u.email = ?
      `).get(email) as any;
      
      console.log("Login attempt for email:", email, "Success:", !!user);
      
      if (user) {
        if (user.role === 'guru') {
          if (user.status === 'rejected') {
            return res.status(403).json({ success: false, message: "Pendaftaran tutor Anda telah ditolak. Silahkan hubungi support untuk informasi lebih lanjut." });
          }
        }
        // Return both for compatibility
        user.profile_picture = user.avatar_url;
        res.json({ success: true, user });
      } else {
        res.status(401).json({ success: false, message: "Email atau password salah." });
      }
    } catch (err: any) {
      console.error("Login Error:", err);
      res.status(500).json({ success: false, message: "Terjadi kesalahan internal server." });
    }
  });

  app.post("/api/register", (req, res) => {
    const { email, password, full_name, role, ktp_url, ktm_url, bio, kampus, tarif, session_duration, gender, lokasi, subjectIds } = req.body;
    
    if (!password || password.length < 6) {
      return res.status(400).json({ success: false, message: "Password minimal 6 karakter." });
    }

    try {
      const hashedPassword = hashPassword(password);
      const encryptedKtp = encryptData(ktp_url);
      const encryptedKtm = encryptData(ktm_url);

      const result = db.prepare("INSERT INTO users (email, password, full_name, role) VALUES (?, ?, ?, ?)").run(email, hashedPassword, full_name, role);
      const userId = result.lastInsertRowid;
      if (role === 'guru') {
        db.prepare("INSERT INTO guru_profiles (user_id, status, ktp_url, ktm_url, bio, kampus, tarif, session_duration, gender, lokasi) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
          userId, 'pending', encryptedKtp, encryptedKtm, bio, kampus, tarif || 0, session_duration || 60, gender, lokasi
        );
        if (subjectIds && Array.isArray(subjectIds)) {
          const stmt = db.prepare("INSERT INTO guru_mapel (guru_id, mapel_id) VALUES (?, ?)");
          subjectIds.forEach(sid => stmt.run(userId, sid));
        }
      } else if (role === 'murid') {
        db.prepare("INSERT INTO murid_profiles (user_id) VALUES (?)").run(userId);
      }
      res.json({ success: true, userId });
    } catch (e) {
      console.error("Registration error details:", e);
      res.status(400).json({ success: false, message: "Email sudah terdaftar atau data tidak valid." });
    }
  });

  app.get("/api/subjects", (req, res) => {
    const subjects = db.prepare("SELECT * FROM mata_pelajaran").all();
    res.json(subjects);
  });

  app.get("/api/profile/:userId", (req, res) => {
    const user = db.prepare(`
      SELECT u.*, 
      (SELECT AVG(rating) FROM reviews WHERE reviewee_id = u.id AND status = 'approved') as avg_rating,
      (SELECT COUNT(*) FROM reviews WHERE reviewee_id = u.id AND status = 'approved') as review_count
      FROM users u WHERE id = ?
    `).get(req.params.userId) as any;
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    let profile;
    if (user.role === 'guru') {
      profile = db.prepare("SELECT * FROM guru_profiles WHERE user_id = ?").get(user.id) as any;
      if (profile) {
        profile.ktp_url = decryptData(profile.ktp_url);
        profile.ktm_url = decryptData(profile.ktm_url);
      }
      const subjects = db.prepare(`
        SELECT mp.* FROM mata_pelajaran mp
        JOIN guru_mapel gm ON mp.id = gm.mapel_id
        WHERE gm.guru_id = ?
      `).all(user.id);
      profile.subjects = subjects;
    } else {
      profile = db.prepare("SELECT * FROM murid_profiles WHERE user_id = ?").get(user.id);
    }
    
    // Explicitly hide password field from the frontend client for security compliance
    if (user) {
      delete user.password;
    }
    
    res.json({ user, profile });
  });

  app.post("/api/profile/update", (req, res) => {
    const { userId, full_name, bio, kampus, tarif, session_duration, gender, lokasi, subjectIds, avatar_url } = req.body;
    try {
      db.prepare("UPDATE users SET full_name = ? WHERE id = ?").run(full_name, userId);
      
      const user = db.prepare("SELECT role FROM users WHERE id = ?").get(userId) as { role: string };
      if (user.role === 'guru') {
        db.prepare("UPDATE guru_profiles SET bio = ?, kampus = ?, tarif = ?, session_duration = ?, gender = ?, lokasi = ?, avatar_url = ? WHERE user_id = ?")
          .run(bio, kampus, tarif, session_duration, gender, lokasi, avatar_url, userId);
        
        if (subjectIds && Array.isArray(subjectIds)) {
          db.prepare("DELETE FROM guru_mapel WHERE guru_id = ?").run(userId);
          const stmt = db.prepare("INSERT INTO guru_mapel (guru_id, mapel_id) VALUES (?, ?)");
          subjectIds.forEach(sid => stmt.run(userId, sid));
        }
      } else {
        db.prepare("UPDATE murid_profiles SET bio = ?, avatar_url = ? WHERE user_id = ?")
          .run(bio, avatar_url, userId);
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  app.post("/api/profile/security", (req, res) => {
    const { userId, currentPassword, newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: "Password baru minimal 6 karakter." });
    }

    try {
      const user = db.prepare("SELECT password FROM users WHERE id = ?").get(userId) as any;
      if (!user) return res.status(404).json({ success: false, message: "User tidak ditemukan" });
      
      if (!comparePassword(currentPassword, user.password)) {
        return res.status(400).json({ success: false, message: "Password saat ini salah." });
      }

      const hashedNewPassword = hashPassword(newPassword);
      db.prepare("UPDATE users SET password = ? WHERE id = ?").run(hashedNewPassword, userId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // Swipe Engine
  app.get("/api/tutors", (req, res) => {
    const { userId, subject, gender, lokasi, maxPrice } = req.query;
    
    const queryParams: any[] = [userId, userId];
    let sql = `
      SELECT u.id, u.email, u.full_name, u.role, u.created_at,
             gp.bio, gp.tarif, gp.session_duration, gp.kampus, gp.avatar_url, gp.status, gp.gender, gp.lokasi,
             (SELECT group_concat(nama_mapel) FROM mata_pelajaran mp JOIN guru_mapel gm ON mp.id = gm.mapel_id WHERE gm.guru_id = u.id) as subjects,
             (SELECT AVG(rating) FROM reviews WHERE reviewee_id = u.id AND status = 'approved') as avg_rating,
             (SELECT COUNT(*) FROM reviews WHERE reviewee_id = u.id AND status = 'approved') as review_count,
             
             -- Prioritized sorting score
             (CASE 
               WHEN (SELECT AVG(rating) FROM reviews WHERE reviewee_id = u.id AND status = 'approved') IS NOT NULL
               THEN (SELECT AVG(rating) FROM reviews WHERE reviewee_id = u.id AND status = 'approved')
               ELSE 3.5
              END) +
             (CASE
               WHEN (strftime('%s', 'now') - strftime('%s', u.created_at)) < 604800 
               THEN (5.0 * (1.0 - (strftime('%s', 'now') - strftime('%s', u.created_at)) / 604800.0))
               ELSE 0.0
              END) AS swipe_score
      FROM users u
      JOIN guru_profiles gp ON u.id = gp.user_id
      WHERE u.role = 'guru' AND gp.status = 'approved'
        AND u.id NOT IN (SELECT swiped_id FROM swipes WHERE swiper_id = ?)
        AND u.id != ?
    `;

    if (gender && gender !== 'Semua') {
      sql += ` AND gp.gender = ?`;
      queryParams.push(gender);
    }

    if (lokasi && lokasi !== 'Semua') {
      sql += ` AND gp.lokasi = ?`;
      queryParams.push(lokasi);
    }

    if (maxPrice) {
      sql += ` AND gp.tarif <= ?`;
      queryParams.push(Number(maxPrice));
    }

    if (subject && subject !== 'Semua') {
      sql += ` AND u.id IN (
        SELECT gm.guru_id 
        FROM guru_mapel gm
        JOIN mata_pelajaran mp ON gm.mapel_id = mp.id
        WHERE mp.nama_mapel = ?
      )`;
      queryParams.push(subject);
    }

    // Sort by priority swipe_score, with small random variation among comparable accounts, and limit to 15 cards
    sql += ` ORDER BY swipe_score DESC, RANDOM() LIMIT 15`;

    try {
      const tutors = db.prepare(sql).all(...queryParams);
      res.json(tutors);
    } catch (err: any) {
      console.error("Fetch tutors error:", err);
      res.status(500).json({ success: false, message: err.message });
    }
  });

  app.post("/api/swipe", (req, res) => {
    const { swiperId, swipedId, direction } = req.body;
    db.prepare("INSERT INTO swipes (swiper_id, swiped_id, direction) VALUES (?, ?, ?)").run(swiperId, swipedId, direction);
    res.json({ success: true });
  });

  app.get("/api/match-limit-status/:userId", (req, res) => {
    const { userId } = req.params;
    try {
      const user = db.prepare("SELECT role FROM users WHERE id = ?").get(userId) as { role: string } | undefined;
      let matchCount = 0;
      let limitReached = false;
      const maxLimit = 5;

      if (user && user.role === "murid") {
        const result = db.prepare(`
          SELECT COUNT(*) as count FROM matches 
          WHERE (user1_id = ? OR user2_id = ?) 
          AND created_at >= datetime('now', '-1 day')
        `).get(userId, userId) as { count: number };
        matchCount = result.count;
        if (matchCount >= maxLimit) {
          limitReached = true;
        }
      }

      res.json({ success: true, matchCount, maxLimit, limitReached, role: user?.role });
    } catch (err: any) {
      console.error("Error checking match limit", err);
      res.status(500).json({ success: false, message: err.message });
    }
  });

  app.post("/api/finalize-match", (req, res) => {
    const { userId, forcedTutorId } = req.body;
    
    // Check if murid exceeds daily matches limit (max 5)
    try {
      const user = db.prepare("SELECT role FROM users WHERE id = ?").get(userId) as { role: string } | undefined;
      if (user && user.role === "murid") {
        const result = db.prepare(`
          SELECT COUNT(*) as count FROM matches 
          WHERE (user1_id = ? OR user2_id = ?) 
          AND created_at >= datetime('now', '-1 day')
        `).get(userId, userId) as { count: number };
        
        if (result.count >= 5) {
          return res.status(403).json({
            match: false,
            message: "Batas limit tercapai: Anda sudah mencapai batas maksimal 5 match dalam sehari. Silakan coba lagi besok!"
          });
        }
      }
    } catch (err: any) {
      console.error("Error verifying match limit during finalization:", err);
    }

    let targetTutorId = forcedTutorId;

    if (!targetTutorId) {
      // Original random logic as fallback
      const candidate = db.prepare(`
        SELECT swiped_id FROM swipes 
        WHERE swiper_id = ? AND direction = 'right' 
        AND swiped_id NOT IN (SELECT user1_id FROM matches WHERE user2_id = ? UNION SELECT user2_id FROM matches WHERE user1_id = ?)
        ORDER BY RANDOM() LIMIT 1
      `).get(userId, userId, userId) as { swiped_id: number } | undefined;
      
      if (candidate) targetTutorId = candidate.swiped_id;
    }

    if (targetTutorId) {
      // Check if match already exists to avoid duplicates
      let matchId;
      const matchExist = db.prepare("SELECT id FROM matches WHERE (user1_id = ? AND user2_id = ?) OR (user1_id = ? AND user2_id = ?)")
        .get(userId, targetTutorId, targetTutorId, userId) as { id: number } | undefined;
      
      if (matchExist) {
        matchId = matchExist.id;
      } else {
        const match = db.prepare("INSERT INTO matches (user1_id, user2_id) VALUES (?, ?)").run(userId, targetTutorId);
        matchId = match.lastInsertRowid;
      }
      
      const matchDetails = db.prepare(`
        SELECT m.id, u.full_name as other_name, gp.avatar_url as other_avatar, u.id as other_id, gp.tarif, gp.session_duration
        FROM matches m
        JOIN users u ON u.id = ?
        JOIN guru_profiles gp ON u.id = gp.user_id
        WHERE m.id = ?
      `).get(targetTutorId, matchId);

      res.json({ match: true, matchDetails });
    } else {
      res.json({ match: false, message: "Kamu belum menyukai siapapun atau semua sudah match!" });
    }
  });

  app.post("/api/reset-swipes", (req, res) => {
    const { userId } = req.body;
    try {
      // Find matches first for manual cleanup in case CASCADE isn't on for existing tables
      const matches = db.prepare("SELECT id FROM matches WHERE user1_id = ? OR user2_id = ?").all(userId, userId) as any[];
      const matchIds = matches.map(m => m.id);

      if (matchIds.length > 0) {
        const placeholders = matchIds.map(() => "?").join(",");
        db.prepare(`DELETE FROM messages WHERE match_id IN (${placeholders})`).run(...matchIds);
        db.prepare(`DELETE FROM bookings WHERE match_id IN (${placeholders})`).run(...matchIds);
      }

      db.prepare("DELETE FROM swipes WHERE swiper_id = ? OR swiped_id = ?").run(userId, userId);
      db.prepare("DELETE FROM matches WHERE user1_id = ? OR user2_id = ?").run(userId, userId);
      res.json({ success: true });
    } catch (e: any) {
      console.error("Reset swipes error:", e);
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // Matches & Chat
  app.get("/api/matches", (req, res) => {
    const { userId } = req.query;
    const matches = db.prepare(`
      SELECT m.*, 
      CASE WHEN m.user1_id = ? THEN u2.full_name ELSE u1.full_name END as other_name,
      CASE WHEN m.user1_id = ? THEN COALESCE(gp2.avatar_url, mp2.avatar_url) ELSE COALESCE(gp1.avatar_url, mp1.avatar_url) END as other_avatar,
      CASE WHEN m.user1_id = ? THEN m.user2_id ELSE m.user1_id END as other_id,
      CASE WHEN m.user1_id = ? THEN gp2.tarif ELSE gp1.tarif END as tarif,
      CASE WHEN m.user1_id = ? THEN gp2.session_duration ELSE gp1.session_duration END as session_duration,
      (SELECT AVG(rating) FROM reviews WHERE reviewee_id = (CASE WHEN m.user1_id = ? THEN m.user2_id ELSE m.user1_id END) AND status = 'approved') as avg_rating,
      (SELECT COUNT(*) FROM reviews WHERE reviewee_id = (CASE WHEN m.user1_id = ? THEN m.user2_id ELSE m.user1_id END) AND status = 'approved') as review_count
      FROM matches m
      JOIN users u1 ON m.user1_id = u1.id
      JOIN users u2 ON m.user2_id = u2.id
      LEFT JOIN guru_profiles gp1 ON u1.id = gp1.user_id
      LEFT JOIN guru_profiles gp2 ON u2.id = gp2.user_id
      LEFT JOIN murid_profiles mp1 ON u1.id = mp1.user_id
      LEFT JOIN murid_profiles mp2 ON u2.id = mp2.user_id
      WHERE m.user1_id = ? OR m.user2_id = ?
    `).all(userId, userId, userId, userId, userId, userId, userId, userId, userId);
    res.json(matches);
  });

  app.get("/api/messages/:matchId", (req, res) => {
    const messages = db.prepare("SELECT * FROM messages WHERE match_id = ? ORDER BY timestamp ASC").all(req.params.matchId);
    res.json(messages);
  });

  app.post("/api/messages", (req, res) => {
    const { matchId, senderId, content } = req.body;
    db.prepare("INSERT INTO messages (match_id, sender_id, content) VALUES (?, ?, ?)").run(matchId, senderId, content);
    res.json({ success: true });
  });

  // Bookings
  app.post("/api/bookings", (req, res) => {
    const { muridId, guruId, matchId, amount, sessionCount, sessionDate } = req.body;
    db.prepare("INSERT INTO bookings (murid_id, guru_id, match_id, amount, session_count, session_date, status) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      muridId, guruId, matchId, amount, sessionCount || 1, sessionDate, 'requested'
    );
    res.json({ success: true });
  });

  app.get("/api/bookings/:userId", (req, res) => {
    const bookings = db.prepare(`
      SELECT b.*, u.full_name as other_name, COALESCE(gp.avatar_url, mp.avatar_url) as other_avatar
      FROM bookings b
      JOIN users u ON (b.murid_id = u.id OR b.guru_id = u.id)
      LEFT JOIN guru_profiles gp ON u.id = gp.user_id
      LEFT JOIN murid_profiles mp ON u.id = mp.user_id
      WHERE (b.murid_id = ? OR b.guru_id = ?) AND u.id != ?
      ORDER BY b.created_at DESC
    `).all(req.params.userId, req.params.userId, req.params.userId);
    res.json(bookings);
  });

  app.post("/api/bookings/:id/accept", (req, res) => {
    db.prepare("UPDATE bookings SET status = 'unpaid' WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  app.post("/api/bookings/:id/cancel", (req, res) => {
    db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  app.post("/api/bookings/:id/pay", (req, res) => {
    db.prepare("UPDATE bookings SET status = 'paid' WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  app.post("/api/bookings/:id/complete", (req, res) => {
    db.prepare("UPDATE bookings SET status = 'completed' WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  // Reviews
  app.post("/api/reviews/submit", (req, res) => {
    const { bookingId, reviewerId, revieweeId, rating, comment } = req.body;
    try {
      const exists = db.prepare("SELECT id FROM reviews WHERE booking_id = ? AND reviewer_id = ?").get(bookingId, reviewerId);
      if (exists) {
        return res.status(400).json({ success: false, message: "Anda sudah memberikan ulasan untuk pesanan ini." });
      }

      db.prepare("INSERT INTO reviews (booking_id, reviewer_id, reviewee_id, rating, comment, status) VALUES (?, ?, ?, ?, ?, ?)")
        .run(bookingId, reviewerId, revieweeId, rating, comment, 'approved');
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  app.get("/api/reviews/check/:bookingId/:userId", (req, res) => {
    const review = db.prepare("SELECT * FROM reviews WHERE booking_id = ? AND reviewer_id = ?").get(req.params.bookingId, req.params.userId);
    res.json({ hasReviewed: !!review, review });
  });

  app.get("/api/reviews/user/:userId", (req, res) => {
    const reviews = db.prepare(`
      SELECT r.*, u.full_name as reviewer_name, COALESCE(gp.avatar_url, mp.avatar_url) as reviewer_avatar
      FROM reviews r
      JOIN users u ON r.reviewer_id = u.id
      LEFT JOIN guru_profiles gp ON u.id = gp.user_id
      LEFT JOIN murid_profiles mp ON u.id = mp.user_id
      WHERE r.reviewee_id = ? AND r.status = 'approved'
      ORDER BY r.created_at DESC
    `).all(req.params.userId);
    res.json(reviews);
  });

  app.get("/api/admin/reviews", (req, res) => {
    res.json([]);
  });

  app.post("/api/admin/reviews/moderate", (req, res) => {
    res.json({ success: true });
  });

  // Admin Endpoints
  app.get("/api/admin/reports", (req, res) => {
    try {
      const totalUsers = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'murid'").get() as any;
      const totalMatches = db.prepare("SELECT COUNT(*) as count FROM matches").get() as any;
      const totalGurus = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'guru'").get() as any;
      const pendingGurus = db.prepare("SELECT COUNT(*) as count FROM guru_profiles WHERE status = 'pending'").get() as any;

      res.json({
        totalUsers: totalUsers.count,
        totalMatches: totalMatches.count,
        totalGurus: totalGurus.count,
        pendingGurus: pendingGurus.count
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/gurus", (req, res) => {
    const gurus = db.prepare(`
      SELECT u.id, u.email, u.full_name, gp.*,
      (SELECT group_concat(nama_mapel) FROM mata_pelajaran mp JOIN guru_mapel gm ON mp.id = gm.mapel_id WHERE gm.guru_id = u.id) as subjects
      FROM users u
      JOIN guru_profiles gp ON u.id = gp.user_id
      WHERE u.role = 'guru'
      ORDER BY gp.status DESC, u.created_at DESC
    `).all() as any[];

    // Decrypt KTP and KTM attachments safely for authorized Admin auditing
    gurus.forEach(g => {
      g.ktp_url = decryptData(g.ktp_url);
      g.ktm_url = decryptData(g.ktm_url);
    });

    res.json(gurus);
  });

  app.post("/api/admin/verify/:id", (req, res) => {
    const { status } = req.body;
    try {
      db.prepare("UPDATE guru_profiles SET status = ? WHERE user_id = ?").run(status === 'verified' ? 'approved' : 'rejected', req.params.id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Database migration
  try {
    const columns = db.prepare("PRAGMA table_info(guru_profiles)").all() as any[];
    const colNames = columns.map(c => c.name);
    if (!colNames.includes('ktp_url')) {
      db.prepare("ALTER TABLE guru_profiles ADD COLUMN ktp_url TEXT").run();
    }
    if (!colNames.includes('ktm_url')) {
      db.prepare("ALTER TABLE guru_profiles ADD COLUMN ktm_url TEXT").run();
    }
    if (!colNames.includes('tarif')) {
      db.prepare("ALTER TABLE guru_profiles ADD COLUMN tarif INTEGER DEFAULT 0").run();
    }
    if (!colNames.includes('gender')) {
      db.prepare("ALTER TABLE guru_profiles ADD COLUMN gender TEXT").run();
    }
    if (!colNames.includes('lokasi')) {
      db.prepare("ALTER TABLE guru_profiles ADD COLUMN lokasi TEXT").run();
    }
    if (!colNames.includes('session_duration')) {
      db.prepare("ALTER TABLE guru_profiles ADD COLUMN session_duration INTEGER DEFAULT 60").run();
    }

    // Bookings table migration
    const bookingsColumns = db.prepare("PRAGMA table_info(bookings)").all() as any[];
    const bColNames = bookingsColumns.map(c => c.name);
    if (!bColNames.includes('session_count')) {
      db.prepare("ALTER TABLE bookings ADD COLUMN session_count INTEGER DEFAULT 1").run();
    }
    try {
      // Try to insert a dummy with 'requested' status. If it fails, we need to refresh the table.
      db.prepare("INSERT INTO bookings (murid_id, guru_id, match_id, amount, session_date, status) VALUES (0, 0, 0, 0, '2000-01-01', 'requested')").run();
      db.prepare("DELETE FROM bookings WHERE status = 'requested' AND amount = 0").run();
    } catch (e: any) {
      if (e.message.includes("CHECK constraint failed")) {
        console.log("Upgrading bookings table schema...");
        db.exec(`
          CREATE TABLE bookings_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            murid_id INTEGER NOT NULL,
            guru_id INTEGER NOT NULL,
            match_id INTEGER NOT NULL,
            amount INTEGER NOT NULL,
            session_date DATETIME NOT NULL,
            status TEXT CHECK(status IN ('requested', 'unpaid', 'paid', 'completed', 'cancelled')) DEFAULT 'requested',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(murid_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY(guru_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY(match_id) REFERENCES matches(id) ON DELETE CASCADE
          );
          INSERT INTO bookings_new (id, murid_id, guru_id, match_id, amount, session_date, status, created_at)
          SELECT id, murid_id, guru_id, match_id, amount, session_date, status, created_at FROM bookings;
          DROP TABLE bookings;
          ALTER TABLE bookings_new RENAME TO bookings;
        `);
      }
    }

    // Migration to set all existing reviews to approved
    db.prepare("UPDATE reviews SET status = 'approved' WHERE status = 'pending'").run();

    // Migrate plain-text passwords of seed or existing users to bcrypt hashes
    try {
      const allUsers = db.prepare("SELECT id, password FROM users").all() as any[];
      const updatePassStmt = db.prepare("UPDATE users SET password = ? WHERE id = ?");
      allUsers.forEach(u => {
        if (u.password && !u.password.startsWith("$2a$") && !u.password.startsWith("$2b$")) {
          const hashed = hashPassword(u.password);
          updatePassStmt.run(hashed, u.id);
          console.log(`[Security Migrator] Safely migrated User ID ${u.id} password to bcrypt.`);
        }
      });
    } catch (passErr) {
      console.error("[Security Migrator] Password migration failed:", passErr);
    }

    // Migrate plain-text KTP/KTM of existing profiles to encrypted formats
    try {
      const allProfiles = db.prepare("SELECT user_id, ktp_url, ktm_url FROM guru_profiles").all() as any[];
      const updateProfileDocsStmt = db.prepare("UPDATE guru_profiles SET ktp_url = ?, ktm_url = ? WHERE user_id = ?");
      allProfiles.forEach(p => {
        let changed = false;
        let encryptedKtp = p.ktp_url;
        let encryptedKtm = p.ktm_url;
        
        if (p.ktp_url && !p.ktp_url.includes(":")) {
          encryptedKtp = encryptData(p.ktp_url);
          changed = true;
        }
        if (p.ktm_url && !p.ktm_url.includes(":")) {
          encryptedKtm = encryptData(p.ktm_url);
          changed = true;
        }
        
        if (changed) {
          updateProfileDocsStmt.run(encryptedKtp, encryptedKtm, p.user_id);
          console.log(`[Security Migrator] Safely encrypted KTP/KTM files for Profile/User ID ${p.user_id}.`);
        }
      });
    } catch (docErr) {
      console.error("[Security Migrator] Document migration failed:", docErr);
    }

    console.log("Migration check complete.");
  } catch (err) {
    console.error("Migration error:", err);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
