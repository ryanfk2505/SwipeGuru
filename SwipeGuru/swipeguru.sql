-- SwipeGuru Database Schema
CREATE DATABASE IF NOT EXISTS swipeguru;
USE swipeguru;

-- Users Table
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    role ENUM('guru', 'murid', 'admin') NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Guru Profiles
CREATE TABLE guru_profiles (
    user_id INT PRIMARY KEY,
    bio TEXT,
    tarif INT DEFAULT 0,
    kampus VARCHAR(255),
    avatar_url VARCHAR(255),
    status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Murid Profiles
CREATE TABLE murid_profiles (
    user_id INT PRIMARY KEY,
    bio TEXT,
    avatar_url VARCHAR(255),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Subjects
CREATE TABLE mata_pelajaran (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nama_mapel VARCHAR(100) UNIQUE NOT NULL
);

-- Guru Subjects (Many-to-Many)
CREATE TABLE guru_mapel (
    guru_id INT,
    mapel_id INT,
    PRIMARY KEY (guru_id, mapel_id),
    FOREIGN KEY (guru_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (mapel_id) REFERENCES mata_pelajaran(id) ON DELETE CASCADE
);

-- Swipes
CREATE TABLE swipes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    swiper_id INT NOT NULL,
    swiped_id INT NOT NULL,
    direction ENUM('left', 'right') NOT NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (swiper_id) REFERENCES users(id),
    FOREIGN KEY (swiped_id) REFERENCES users(id)
);

-- Matches
CREATE TABLE matches (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user1_id INT NOT NULL,
    user2_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user1_id) REFERENCES users(id),
    FOREIGN KEY (user2_id) REFERENCES users(id)
);

-- Messages
CREATE TABLE messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    match_id INT NOT NULL,
    sender_id INT NOT NULL,
    content TEXT NOT NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (match_id) REFERENCES matches(id),
    FOREIGN KEY (sender_id) REFERENCES users(id)
);

-- Bookings (Transactions)
CREATE TABLE bookings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    murid_id INT NOT NULL,
    guru_id INT NOT NULL,
    match_id INT NOT NULL,
    amount INT NOT NULL,
    session_date DATETIME NOT NULL,
    status ENUM('unpaid', 'paid', 'completed', 'cancelled') DEFAULT 'unpaid',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (murid_id) REFERENCES users(id),
    FOREIGN KEY (guru_id) REFERENCES users(id),
    FOREIGN KEY (match_id) REFERENCES matches(id)
);

-- Views
CREATE VIEW v_guru_list AS
SELECT u.full_name, gp.bio, gp.tarif, gp.kampus, gp.avatar_url, 
       GROUP_CONCAT(mp.nama_mapel) as subjects
FROM users u
JOIN guru_profiles gp ON u.id = gp.user_id
LEFT JOIN guru_mapel gm ON u.id = gm.guru_id
LEFT JOIN mata_pelajaran mp ON gm.mapel_id = mp.id
WHERE u.role = 'guru' AND gp.status = 'approved'
GROUP BY u.id;

-- Seed Data
INSERT INTO users (email, password, full_name, role) VALUES ('admin@swipeguru.com', 'admin123', 'Super Admin', 'admin');
INSERT INTO mata_pelajaran (nama_mapel) VALUES ('Matematika'), ('Fisika'), ('Kimia'), ('Bahasa Inggris');
