const crypto = require("crypto");
require("dotenv").config();

// Use a 32-byte key for AES-256-GCM from env, or generate a fallback
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY 
  ? process.env.ENCRYPTION_KEY.padEnd(32, '0').substring(0, 32)
  : "default_fallback_secret_key_12345"; // For dev if not set

function encryptText(text) {
  if (!text) return "";
  try {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(ENCRYPTION_KEY, "utf-8"), iv);
    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag().toString("hex");
    return `${iv.toString("hex")}:${authTag}:${encrypted}`;
  } catch (err) {
    console.error("Encryption failed:", err);
    return "";
  }
}

function decryptText(cipherText) {
  if (!cipherText) return "";
  const parts = cipherText.split(":");
  // If it's not encrypted using our format, return as-is
  if (parts.length !== 3) return cipherText;

  try {
    const [ivHex, authTagHex, encryptedHex] = parts;
    const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(ENCRYPTION_KEY, "utf-8"), Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
    let decrypted = decipher.update(encryptedHex, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (err) {
    console.error("Decryption failed:", err);
    return cipherText; // Fallback in case it wasn't actually encrypted but had 2 colons
  }
}

module.exports = {
  encryptText,
  decryptText
};
