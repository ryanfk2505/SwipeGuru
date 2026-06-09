import Database from 'better-sqlite3';

const db = new Database('swipeguru.db');
db.exec('PRAGMA foreign_keys = ON;');

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT CHECK(role IN ('guru', 'murid', 'admin')) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS guru_profiles (
    user_id INTEGER PRIMARY KEY,
    bio TEXT,
    tarif INTEGER DEFAULT 0,
    session_duration INTEGER DEFAULT 60,
    kampus TEXT,
    gender TEXT,
    lokasi TEXT,
    avatar_url TEXT,
    ktp_url TEXT,
    ktm_url TEXT,
    status TEXT CHECK(status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS murid_profiles (
    user_id INTEGER PRIMARY KEY,
    bio TEXT,
    avatar_url TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS mata_pelajaran (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nama_mapel TEXT UNIQUE NOT NULL
  );

  CREATE TABLE IF NOT EXISTS guru_mapel (
    guru_id INTEGER,
    mapel_id INTEGER,
    PRIMARY KEY(guru_id, mapel_id),
    FOREIGN KEY(guru_id) REFERENCES guru_profiles(user_id) ON DELETE CASCADE,
    FOREIGN KEY(mapel_id) REFERENCES mata_pelajaran(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS swipes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    swiper_id INTEGER NOT NULL,
    swiped_id INTEGER NOT NULL,
    direction TEXT CHECK(direction IN ('left', 'right')) NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(swiper_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(swiped_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user1_id INTEGER NOT NULL,
    user2_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user1_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(user2_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id INTEGER NOT NULL,
    sender_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(match_id) REFERENCES matches(id) ON DELETE CASCADE,
    FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    murid_id INTEGER NOT NULL,
    guru_id INTEGER NOT NULL,
    match_id INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    session_count INTEGER DEFAULT 1,
    session_date DATETIME NOT NULL,
    status TEXT CHECK(status IN ('requested', 'unpaid', 'paid', 'completed', 'cancelled')) DEFAULT 'requested',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(murid_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(guru_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(match_id) REFERENCES matches(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id INTEGER NOT NULL,
    reviewer_id INTEGER NOT NULL,
    reviewee_id INTEGER NOT NULL,
    rating INTEGER CHECK(rating >= 1 AND rating <= 5) NOT NULL,
    comment TEXT,
    status TEXT CHECK(status IN ('pending', 'approved', 'rejected')) DEFAULT 'approved',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
    FOREIGN KEY(reviewer_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(reviewee_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// Seed Data
const seedData = () => {
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  if (userCount.count > 0) return;

  // Insert Admin
  db.prepare('INSERT INTO users (email, password, full_name, role) VALUES (?, ?, ?, ?)').run(
    'admin@swipeguru.com', 'admin123', 'Super Admin', 'admin'
  );

  // Insert Mapel
  const mapels = ['Matematika', 'Fisika', 'Kimia', 'Biologi', 'Bahasa Inggris', 'Ekonomi'];
  mapels.forEach(m => db.prepare('INSERT INTO mata_pelajaran (nama_mapel) VALUES (?)').run(m));

  // Insert Gurus (Tutors)
  const tutors = [
    { name: 'Budi Santoso', email: 'budi@ui.ac.id', bio: 'Mahasiswa Teknik UI, hobi ngajar MTK.', tarif: 150000, kampus: 'UI', avatar: 'https://i.pravatar.cc/150?u=budi', gender: 'Laki-laki', lokasi: 'Jakarta' },
    { name: 'Siti Aminah', email: 'siti@itb.ac.id', bio: 'Expert Fisika & Kimia, santai tapi masuk.', tarif: 125000, kampus: 'ITB', avatar: 'https://i.pravatar.cc/150?u=siti', gender: 'Perempuan', lokasi: 'Bandung' },
    { name: 'Andi Wijaya', email: 'andi@ugm.ac.id', bio: 'Bahasa Inggris seru bareng debat champion.', tarif: 100000, kampus: 'UGM', avatar: 'https://i.pravatar.cc/150?u=andi', gender: 'Laki-laki', lokasi: 'Yogyakarta' },
    { name: 'Rina Kartika', email: 'rina@unpad.ac.id', bio: 'Biologi asik lewat visualisasi.', tarif: 110000, kampus: 'UNPAD', avatar: 'https://i.pravatar.cc/150?u=rina', gender: 'Perempuan', lokasi: 'Bandung' },
  ];

  tutors.forEach(t => {
    const res = db.prepare('INSERT INTO users (email, password, full_name, role) VALUES (?, ?, ?, ?)').run(
      t.email, 'password123', t.name, 'guru'
    );
    db.prepare('INSERT INTO guru_profiles (user_id, bio, tarif, kampus, avatar_url, gender, lokasi, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      res.lastInsertRowid, t.bio, t.tarif, t.kampus, t.avatar, t.gender, t.lokasi, 'approved'
    );
    // Assign mapel
    db.prepare('INSERT INTO guru_mapel (guru_id, mapel_id) VALUES (?, ?)').run(res.lastInsertRowid, (Number(res.lastInsertRowid) % 6) + 1);
  });

  // Insert Murid
  const muridRes = db.prepare('INSERT INTO users (email, password, full_name, role) VALUES (?, ?, ?, ?)').run(
    'murid@gmail.com', 'murid123', 'Abyan Murid', 'murid'
  );
  db.prepare('INSERT INTO murid_profiles (user_id, bio, avatar_url) VALUES (?, ?, ?)').run(
    muridRes.lastInsertRowid, 'Siswa SMA butuh tutor sabar.', 'https://i.pravatar.cc/150?u=abyan'
  );
};

seedData();

export default db;
