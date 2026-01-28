import { pgTable, text, serial, integer, boolean, timestamp, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

// User roles enum
export const userRoleSchema = z.enum(["super_admin", "admin", "user"]);
export type UserRole = z.infer<typeof userRoleSchema>;

// Users table - stored in database (except super_admin which is hardcoded)
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("user"),
  email: text("email"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  createdBy: integer("created_by"),
  isActive: boolean("is_active").default(true).notNull(),
});

export const usersRelations = relations(users, ({ one }) => ({
  createdByUser: one(users, {
    fields: [users.createdBy],
    references: [users.id],
  }),
}));

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// Sessions table for login sessions
export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: integer("user_id").notNull(),
  username: text("username").notNull(),
  role: text("role").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}));

export const insertSessionSchema = createInsertSchema(sessions).omit({
  createdAt: true,
});
export type InsertSession = z.infer<typeof insertSessionSchema>;
export type Session = typeof sessions.$inferSelect;

// OLT Credentials table
export const oltCredentials = pgTable("olt_credentials", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  host: text("host").notNull(),
  port: integer("port").notNull().default(22),
  username: text("username").notNull(),
  passwordEncrypted: text("password_encrypted").notNull(),
  protocol: text("protocol").notNull().default("ssh"),
  isActive: boolean("is_active").default(true).notNull(),
  isConnected: boolean("is_connected").default(false).notNull(),
  lastConnected: timestamp("last_connected"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  createdBy: integer("created_by"),
});

export const oltCredentialsRelations = relations(oltCredentials, ({ one }) => ({
  createdByUser: one(users, {
    fields: [oltCredentials.createdBy],
    references: [users.id],
  }),
}));

export const insertOltCredentialSchema = createInsertSchema(oltCredentials).omit({
  id: true,
  createdAt: true,
  isConnected: true,
  lastConnected: true,
});
export type InsertOltCredential = z.infer<typeof insertOltCredentialSchema>;
export type OltCredential = typeof oltCredentials.$inferSelect;

// Login request schema
export const loginRequestSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

// Create user request schema (for admin)
export const createUserRequestSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  role: userRoleSchema.exclude(["super_admin"]),
  email: z.string().email().optional(),
});
export type CreateUserRequest = z.infer<typeof createUserRequestSchema>;

// OLT credential request schema
export const oltCredentialRequestSchema = z.object({
  name: z.string().min(1, "Name is required"),
  host: z.string().min(1, "Host is required"),
  port: z.number().min(1).max(65535).default(22),
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
  protocol: z.enum(["ssh", "telnet"]).default("ssh"),
});
export type OltCredentialRequest = z.infer<typeof oltCredentialRequestSchema>;

// ONU Status schemas
export const onuStatusSchema = z.enum(["online", "offline", "los", "auth-fail"]);
export type OnuStatus = z.infer<typeof onuStatusSchema>;

export const onuConfigStateSchema = z.enum(["normal", "failed", "initial"]);
export type OnuConfigState = z.infer<typeof onuConfigStateSchema>;

// Database tables for OLT data (cached from OLT device)

// Unbound ONUs table - ONUs discovered but not yet configured
export const unboundOnus = pgTable("unbound_onus", {
  id: serial("id").primaryKey(),
  serialNumber: text("serial_number").notNull().unique(),
  gponPort: text("gpon_port").notNull(),
  discoveredAt: timestamp("discovered_at").notNull(),
  equipmentId: text("equipment_id"),
  softwareVersion: text("software_version"),
  oltCredentialId: integer("olt_credential_id").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertUnboundOnuSchema = createInsertSchema(unboundOnus).omit({
  id: true,
  updatedAt: true,
});
export type InsertUnboundOnu = z.infer<typeof insertUnboundOnuSchema>;
export type DbUnboundOnu = typeof unboundOnus.$inferSelect;

// Bound ONUs table - configured ONUs
export const boundOnus = pgTable("bound_onus", {
  id: serial("id").primaryKey(),
  onuId: integer("onu_id").notNull(),
  serialNumber: text("serial_number").notNull(),
  gponPort: text("gpon_port").notNull(),
  description: text("description").default(""),
  lineProfileId: integer("line_profile_id").notNull(),
  serviceProfileId: integer("service_profile_id").notNull(),
  status: text("status").notNull().default("offline"),
  configState: text("config_state").notNull().default("normal"),
  rxPower: real("rx_power"),
  txPower: real("tx_power"),
  distance: integer("distance"),
  vlanId: integer("vlan_id"),
  gemportId: integer("gemport_id"),
  pppoeUsername: text("pppoe_username"),
  pppoePassword: text("pppoe_password"),
  oltCredentialId: integer("olt_credential_id").notNull(),
  boundAt: timestamp("bound_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertBoundOnuSchema = createInsertSchema(boundOnus).omit({
  id: true,
  updatedAt: true,
});
export type InsertBoundOnu = z.infer<typeof insertBoundOnuSchema>;
export type DbBoundOnu = typeof boundOnus.$inferSelect;

// Line profiles table
export const lineProfiles = pgTable("line_profiles", {
  id: serial("id").primaryKey(),
  profileId: integer("profile_id").notNull(),
  name: text("name").notNull(),
  description: text("description").default(""),
  tcont: integer("tcont").default(0),
  gemportId: integer("gemport_id").default(0),
  mappingMode: text("mapping_mode").default(""),
  oltCredentialId: integer("olt_credential_id").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertLineProfileSchema = createInsertSchema(lineProfiles).omit({
  id: true,
  updatedAt: true,
});
export type InsertLineProfile = z.infer<typeof insertLineProfileSchema>;
export type DbLineProfile = typeof lineProfiles.$inferSelect;

// Service profiles table
export const serviceProfiles = pgTable("service_profiles", {
  id: serial("id").primaryKey(),
  profileId: integer("profile_id").notNull(),
  name: text("name").notNull(),
  description: text("description").default(""),
  portCount: integer("port_count").default(1),
  portType: text("port_type").default("eth"),
  oltCredentialId: integer("olt_credential_id").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertServiceProfileSchema = createInsertSchema(serviceProfiles).omit({
  id: true,
  updatedAt: true,
});
export type InsertServiceProfile = z.infer<typeof insertServiceProfileSchema>;
export type DbServiceProfile = typeof serviceProfiles.$inferSelect;

// VLANs table
export const vlans = pgTable("vlans", {
  id: serial("id").primaryKey(),
  vlanId: integer("vlan_id").notNull(),
  name: text("name").notNull(),
  description: text("description").default(""),
  type: text("type").notNull().default("standard"),
  tagged: boolean("tagged").default(false),
  inUse: boolean("in_use").default(false),
  oltCredentialId: integer("olt_credential_id").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertVlanSchema = createInsertSchema(vlans).omit({
  id: true,
  updatedAt: true,
});
export type InsertVlan = z.infer<typeof insertVlanSchema>;
export type DbVlan = typeof vlans.$inferSelect;

// OLT data refresh tracking
export const oltDataRefresh = pgTable("olt_data_refresh", {
  id: serial("id").primaryKey(),
  oltCredentialId: integer("olt_credential_id").notNull().unique(),
  lastRefreshed: timestamp("last_refreshed"),
  refreshInProgress: boolean("refresh_in_progress").default(false),
  lastError: text("last_error"),
});

export const insertOltDataRefreshSchema = createInsertSchema(oltDataRefresh).omit({
  id: true,
});
export type InsertOltDataRefresh = z.infer<typeof insertOltDataRefreshSchema>;
export type OltDataRefresh = typeof oltDataRefresh.$inferSelect;

// Zod schemas for API responses (compatible with existing types)
export const unboundOnuSchema = z.object({
  id: z.string(),
  serialNumber: z.string(),
  gponPort: z.string(),
  discoveredAt: z.string(),
  equipmentId: z.string().optional(),
  softwareVersion: z.string().optional(),
});
export type UnboundOnu = z.infer<typeof unboundOnuSchema>;

export const boundOnuSchema = z.object({
  id: z.string(),
  onuId: z.number(),
  serialNumber: z.string(),
  gponPort: z.string(),
  description: z.string(),
  lineProfileId: z.number(),
  serviceProfileId: z.number(),
  status: onuStatusSchema,
  configState: onuConfigStateSchema,
  rxPower: z.number().optional(),
  txPower: z.number().optional(),
  distance: z.number().optional(),
  boundAt: z.string(),
  vlanId: z.number().optional(),
  gemportId: z.number().optional(),
  pppoeUsername: z.string().optional(),
  pppoePassword: z.string().optional(),
});
export type BoundOnu = z.infer<typeof boundOnuSchema>;

export const lineProfileSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string(),
  tcont: z.number(),
  gemportId: z.number(),
  mappingMode: z.string(),
});
export type LineProfile = z.infer<typeof lineProfileSchema>;

export const serviceProfileSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string(),
  portCount: z.number(),
  portType: z.string(),
});
export type ServiceProfile = z.infer<typeof serviceProfileSchema>;

export const vlanSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string(),
  type: z.enum(["smart", "mux", "standard"]),
  tagged: z.boolean(),
  inUse: z.boolean(),
});
export type Vlan = z.infer<typeof vlanSchema>;

// ONU type for binding - Huawei uses OMCI, General requires manual config
export const onuTypeSchema = z.enum(["huawei", "general"]);
export type OnuType = z.infer<typeof onuTypeSchema>;

export const bindOnuRequestSchema = z.object({
  serialNumber: z.string().min(1, "Serial number is required"),
  gponPort: z.string().min(1, "GPON port is required"),
  lineProfileId: z.number().min(1, "Line profile is required"),
  serviceProfileId: z.number().min(1, "Service profile is required"),
  description: z.string().min(1, "Description is required"),
  vlanId: z.number().optional(),
  pppoeUsername: z.string().optional(),
  pppoePassword: z.string().optional(),
  onuType: onuTypeSchema.default("huawei"),
});
export type BindOnuRequest = z.infer<typeof bindOnuRequestSchema>;

export const unbindOnuRequestSchema = z.object({
  onuId: z.number(),
  gponPort: z.string(),
  cleanConfig: z.boolean().default(false),
  force: z.boolean().default(false),
});
export type UnbindOnuRequest = z.infer<typeof unbindOnuRequestSchema>;

export const onuVerificationSchema = z.object({
  serialNumber: z.string(),
  isUnbound: z.boolean(),
  isBound: z.boolean(),
  isOnline: z.boolean(),
  gponPort: z.string().optional(),
  onuId: z.number().optional(),
  rxPower: z.number().optional(),
  vlanAttached: z.boolean().optional(),
  message: z.string(),
});
export type OnuVerification = z.infer<typeof onuVerificationSchema>;

export const oltInfoSchema = z.object({
  product: z.string(),
  version: z.string(),
  patch: z.string(),
  uptime: z.string(),
  connected: z.boolean(),
  hostname: z.string().optional(),
  model: z.string().optional(),
  serialNumber: z.string().optional(),
});
export type OltInfo = z.infer<typeof oltInfoSchema>;

// Auth response type
export const authResponseSchema = z.object({
  user: z.object({
    id: z.number(),
    username: z.string(),
    role: z.string(),
    email: z.string().nullable(),
  }),
  sessionId: z.string(),
});
export type AuthResponse = z.infer<typeof authResponseSchema>;
