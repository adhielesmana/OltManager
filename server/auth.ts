import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import type { User, UserRole } from "@shared/schema";

// Hardcoded super admin credentials
const SUPER_ADMIN_USERNAME = "adhielesmana";
const SUPER_ADMIN_PASSWORD_HASH = bcrypt.hashSync("admin123!", 10);

export interface AuthUser {
  id: number;
  username: string;
  role: UserRole;
  email: string | null;
}

// Check if credentials match super admin
export function isSuperAdmin(username: string, password: string): boolean {
  return username === SUPER_ADMIN_USERNAME && bcrypt.compareSync(password, SUPER_ADMIN_PASSWORD_HASH);
}

// Get super admin user object
export function getSuperAdminUser(): AuthUser {
  return {
    id: 0, // Special ID for super admin
    username: SUPER_ADMIN_USERNAME,
    role: "super_admin",
    email: null,
  };
}

// Hash password for new users
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

// Verify password against hash
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// Generate session ID
export function generateSessionId(): string {
  return randomUUID();
}

// Calculate session expiry (24 hours from now)
export function getSessionExpiry(): Date {
  const expiry = new Date();
  expiry.setHours(expiry.getHours() + 24);
  return expiry;
}

// Check if user has permission for an action
export function hasPermission(role: UserRole, action: string): boolean {
  const permissions: Record<string, UserRole[]> = {
    // User management
    "user:create": ["super_admin", "admin"],
    "user:delete": ["super_admin", "admin"],
    "user:view": ["super_admin", "admin"],
    
    // OLT management
    "olt:configure": ["super_admin", "admin"],
    "olt:view": ["super_admin", "admin", "user"],
    
    // ONU management
    "onu:bind": ["super_admin", "admin", "user"],
    "onu:unbind": ["super_admin", "admin", "user"],
    "onu:view": ["super_admin", "admin", "user"],
    
    // Profiles and VLANs
    "profiles:view": ["super_admin", "admin", "user"],
    "vlans:view": ["super_admin", "admin", "user"],
  };
  
  return permissions[action]?.includes(role) ?? false;
}

// Check if user can manage another user
export function canManageUser(actorRole: UserRole, targetRole: UserRole, action: "delete" | "edit"): boolean {
  if (actorRole === "super_admin") {
    return true; // Super admin can do anything
  }
  
  if (actorRole === "admin") {
    // Admin cannot delete/edit other admins or super_admin
    if (targetRole === "admin" || targetRole === "super_admin") {
      return false;
    }
    return true; // Can manage regular users
  }
  
  return false; // Regular users cannot manage anyone
}

// Simple encryption for OLT passwords (in production, use proper encryption)
export function encryptOltPassword(password: string): string {
  // Using base64 encoding with a simple transformation
  // In production, use proper AES encryption with a secure key
  const buffer = Buffer.from(password, "utf-8");
  return buffer.toString("base64");
}

export function decryptOltPassword(encrypted: string): string {
  const buffer = Buffer.from(encrypted, "base64");
  return buffer.toString("utf-8");
}
