import crypto from "crypto";
import bcrypt from "bcryptjs";

// Access secure key from environment or fallback to a solid key for development compliance
const ENCRYPTION_KEY = process.env.KTP_ENCRYPTION_KEY || "swipeguru-super-secure-encryption-key-32-chars!!";
// Ensure key is exactly 32 bytes for aes-256-cbc
const keyBuffer = crypto.createHash("sha256").update(ENCRYPTION_KEY).digest();

/**
 * Hashing of passwords using bcryptjs with 10 salt rounds.
 */
export function hashPassword(password: string): string {
  const salt = bcrypt.genSaltSync(10);
  return bcrypt.hashSync(password, salt);
}

/**
 * Verifies if the plaintext password matches the hashed bcrypt pattern.
 * Supports transparent fallback to plaintext during migrations/testing.
 */
export function comparePassword(password: string, hash: string): boolean {
  if (!hash) return false;
  if (!hash.startsWith("$2a$") && !hash.startsWith("$2b$")) {
    return password === hash;
  }
  try {
    return bcrypt.compareSync(password, hash);
  } catch (e) {
    console.error("Bcrypt comparison error:", e);
    return false;
  }
}

/**
 * Encrypts sensitive string data (like KTP/KTM or raw documents) using AES-256-CBC.
 * Returns an IV-prepended hex string.
 */
export function encryptData(data: string | null | undefined): string | null {
  if (!data) return null;
  // If already encrypted, do not double-encrypt
  if (data.includes(":") && data.length > 32) {
    const parts = data.split(":");
    if (parts[0].length === 32) return data; 
  }
  try {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-cbc", keyBuffer, iv);
    let encrypted = cipher.update(data, "utf8", "hex");
    encrypted += cipher.final("hex");
    return iv.toString("hex") + ":" + encrypted;
  } catch (error) {
    console.error("Encryption failed:", error);
    return null;
  }
}

/**
 * Decrypts data using the prepended IV.
 * Transparently falls back to returning the original data if it is not encrypted.
 */
export function decryptData(encryptedData: string | null | undefined): string | null {
  if (!encryptedData) return null;
  try {
    const parts = encryptedData.split(":");
    if (parts.length !== 2 || parts[0].length !== 32) {
      // It's not encrypted using our format, so return as is (transparent fallback)
      return encryptedData;
    }
    const iv = Buffer.from(parts[0], "hex");
    const encryptedText = Buffer.from(parts[1], "hex");
    const decipher = crypto.createDecipheriv("aes-256-cbc", keyBuffer, iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString("utf8");
  } catch (error) {
    // If decryption fails, return the original string just to be safe
    console.error("Decryption failed:", error);
    return encryptedData;
  }
}
