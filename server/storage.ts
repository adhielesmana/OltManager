import { randomUUID } from "crypto";
import { eq, and } from "drizzle-orm";
import { db } from "./db";
import {
  users,
  sessions,
  oltCredentials,
  unboundOnus,
  boundOnus,
  lineProfiles,
  serviceProfiles,
  vlans,
  oltDataRefresh,
  type User,
  type InsertUser,
  type Session,
  type InsertSession,
  type OltCredential,
  type InsertOltCredential,
  type UnboundOnu,
  type BoundOnu,
  type LineProfile,
  type ServiceProfile,
  type Vlan,
  type OltInfo,
  type BindOnuRequest,
  type OnuVerification,
  type OnuStatus,
  type OnuConfigState,
} from "@shared/schema";
import { 
  isSuperAdmin, 
  getSuperAdminUser, 
  hashPassword, 
  verifyPassword,
  generateSessionId,
  getSessionExpiry,
  encryptOltPassword,
  decryptOltPassword,
  type AuthUser,
} from "./auth";
import { huaweiSSH } from "./huawei-ssh";

export interface IStorage {
  // Auth operations
  authenticateUser(username: string, password: string): Promise<AuthUser | null>;
  createSession(userId: number, username: string, role: string): Promise<Session>;
  getSession(sessionId: string): Promise<Session | null>;
  deleteSession(sessionId: string): Promise<void>;
  
  // User management
  getUsers(): Promise<User[]>;
  getUserById(id: number): Promise<User | null>;
  getUserByUsername(username: string): Promise<User | null>;
  createUser(user: InsertUser): Promise<User>;
  deleteUser(id: number): Promise<void>;
  
  // OLT credentials
  getOltCredentials(): Promise<OltCredential[]>;
  getActiveOltCredential(): Promise<OltCredential | null>;
  createOltCredential(credential: InsertOltCredential): Promise<OltCredential>;
  updateOltCredential(id: number, updates: Partial<OltCredential>): Promise<OltCredential>;
  deleteOltCredential(id: number): Promise<void>;
  testOltConnection(id: number): Promise<{ success: boolean; message: string }>;
  
  // OLT data operations (from database, refreshed from OLT on demand)
  refreshOltData(): Promise<{ success: boolean; message: string }>;
  getLastRefreshTime(): Promise<Date | null>;
  getRefreshStatus(): Promise<{ lastRefreshed: Date | null; inProgress: boolean; error: string | null }>;
  getOltInfo(): Promise<OltInfo>;
  getUnboundOnus(): Promise<UnboundOnu[]>;
  getUnboundOnuCount(): Promise<number>;
  getBoundOnus(): Promise<BoundOnu[]>;
  getLineProfiles(): Promise<LineProfile[]>;
  getServiceProfiles(): Promise<ServiceProfile[]>;
  getVlans(): Promise<Vlan[]>;
  validateOnu(serialNumber: string): Promise<{ canBind: boolean; reason: string }>;
  verifyOnu(serialNumber: string): Promise<OnuVerification>;
  bindOnu(request: BindOnuRequest): Promise<BoundOnu>;
  unbindOnu(onuId: number, gponPort: string, cleanConfig: boolean): Promise<void>;
  getNextFreeOnuId(gponPort: string): Promise<number>;
}

export class DatabaseStorage implements IStorage {
  // Lock to prevent concurrent OLT data refresh operations
  private refreshLock: Promise<void> | null = null;
  private autoSyncInterval: NodeJS.Timeout | null = null;

  constructor() {
    console.log("[Storage] Database storage initialized - data served from database");
    // Auto-reconnect to active OLT after startup
    setTimeout(() => this.autoReconnectOlt(), 2000);
    // Start auto-sync every 60 minutes
    this.startAutoSync();
  }

  private startAutoSync(): void {
    // Clear any existing interval
    if (this.autoSyncInterval) {
      clearInterval(this.autoSyncInterval);
    }
    
    // Auto-sync every 60 minutes (3600000 ms)
    const SYNC_INTERVAL = 60 * 60 * 1000;
    console.log("[Storage] Auto-sync enabled: refreshing OLT data every 60 minutes");
    
    this.autoSyncInterval = setInterval(async () => {
      try {
        if (huaweiSSH.isConnected()) {
          console.log("[Storage] Auto-sync: Starting scheduled OLT data refresh...");
          const result = await this.refreshOltData();
          if (result.success) {
            console.log("[Storage] Auto-sync: Completed successfully");
          } else {
            console.log(`[Storage] Auto-sync: Failed - ${result.message}`);
          }
        } else {
          console.log("[Storage] Auto-sync: Skipped - OLT not connected");
        }
      } catch (error: any) {
        console.error("[Storage] Auto-sync error:", error.message);
      }
    }, SYNC_INTERVAL);
  }

  private async autoReconnectOlt(): Promise<void> {
    try {
      const [credential] = await db.select().from(oltCredentials).where(eq(oltCredentials.isActive, true));
      if (!credential) {
        console.log("[Storage] No active OLT credential found");
        return;
      }

      console.log(`[Storage] Auto-reconnecting to OLT: ${credential.name} (${credential.host}:${credential.port})`);
      const password = decryptOltPassword(credential.passwordEncrypted);
      const result = await huaweiSSH.connect({
        host: credential.host,
        port: credential.port,
        username: credential.username,
        password: password,
      });

      if (result.success) {
        console.log("[Storage] Auto-reconnect successful");
        await db.update(oltCredentials)
          .set({ isConnected: true, lastConnected: new Date() })
          .where(eq(oltCredentials.id, credential.id));
        
        // Auto-refresh data after successful connection
        console.log("[Storage] Automatically loading all OLT information...");
        this.refreshOltData().catch(err => {
          console.error("[Storage] Auto-refresh failed:", err.message);
        });
      } else {
        console.log(`[Storage] Auto-reconnect failed: ${result.message}`);
        await db.update(oltCredentials)
          .set({ isConnected: false })
          .where(eq(oltCredentials.id, credential.id));
      }
    } catch (error: any) {
      console.log(`[Storage] Auto-reconnect error: ${error.message}`);
    }
  }

  // Helper to convert database record to API type
  private dbUnboundToApi(dbOnu: any): UnboundOnu {
    return {
      id: dbOnu.id.toString(),
      serialNumber: dbOnu.serialNumber,
      gponPort: dbOnu.gponPort,
      discoveredAt: dbOnu.discoveredAt.toISOString(),
      equipmentId: dbOnu.equipmentId || undefined,
      softwareVersion: dbOnu.softwareVersion || undefined,
    };
  }

  private dbBoundToApi(dbOnu: any): BoundOnu {
    return {
      id: dbOnu.id.toString(),
      onuId: dbOnu.onuId,
      serialNumber: dbOnu.serialNumber,
      gponPort: dbOnu.gponPort,
      description: dbOnu.description || "",
      lineProfileId: dbOnu.lineProfileId,
      serviceProfileId: dbOnu.serviceProfileId,
      status: dbOnu.status as OnuStatus,
      configState: (dbOnu.configState || "normal") as OnuConfigState,
      rxPower: dbOnu.rxPower ?? undefined,
      txPower: dbOnu.txPower ?? undefined,
      distance: dbOnu.distance ?? undefined,
      boundAt: dbOnu.boundAt.toISOString(),
      vlanId: dbOnu.vlanId ?? undefined,
      gemportId: dbOnu.gemportId ?? undefined,
      pppoeUsername: dbOnu.pppoeUsername ?? undefined,
      pppoePassword: dbOnu.pppoePassword ?? undefined,
    };
  }

  private dbLineProfileToApi(dbProfile: any): LineProfile {
    return {
      id: dbProfile.profileId,
      name: dbProfile.name,
      description: dbProfile.description || "",
      tcont: dbProfile.tcont || 0,
      gemportId: dbProfile.gemportId || 0,
      mappingMode: dbProfile.mappingMode || "",
    };
  }

  private dbServiceProfileToApi(dbProfile: any): ServiceProfile {
    return {
      id: dbProfile.profileId,
      name: dbProfile.name,
      description: dbProfile.description || "",
      portCount: dbProfile.portCount || 1,
      portType: dbProfile.portType || "eth",
    };
  }

  private dbVlanToApi(dbVlan: any): Vlan {
    return {
      id: dbVlan.vlanId,
      name: dbVlan.name,
      description: dbVlan.description || "",
      type: (dbVlan.type || "standard") as "smart" | "mux" | "standard",
      tagged: dbVlan.tagged || false,
      inUse: dbVlan.inUse || false,
    };
  }

  // Auth operations
  async authenticateUser(username: string, password: string): Promise<AuthUser | null> {
    // Check super admin first
    if (isSuperAdmin(username, password)) {
      return getSuperAdminUser();
    }
    
    // Check database users
    const [user] = await db.select().from(users).where(eq(users.username, username));
    if (!user || !user.isActive) {
      return null;
    }
    
    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return null;
    }
    
    return {
      id: user.id,
      username: user.username,
      role: user.role as "admin" | "user",
      email: user.email,
    };
  }

  async createSession(userId: number, username: string, role: string): Promise<Session> {
    const sessionId = generateSessionId();
    const expiresAt = getSessionExpiry();
    
    const [session] = await db.insert(sessions).values({
      id: sessionId,
      userId,
      username,
      role,
      expiresAt,
    }).returning();
    
    return session;
  }

  async getSession(sessionId: string): Promise<Session | null> {
    const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
    if (!session) return null;
    
    // Check if session is expired
    if (new Date(session.expiresAt) < new Date()) {
      await this.deleteSession(sessionId);
      return null;
    }
    
    return session;
  }

  async deleteSession(sessionId: string): Promise<void> {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
  }

  // User management
  async getUsers(): Promise<User[]> {
    return db.select().from(users).where(eq(users.isActive, true));
  }

  async getUserById(id: number): Promise<User | null> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || null;
  }

  async getUserByUsername(username: string): Promise<User | null> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || null;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async deleteUser(id: number): Promise<void> {
    // Soft delete - set isActive to false
    await db.update(users).set({ isActive: false }).where(eq(users.id, id));
  }

  // OLT credentials
  async getOltCredentials(): Promise<OltCredential[]> {
    const credentials = await db.select().from(oltCredentials);
    // Override isConnected with actual SSH connection state
    return credentials.map(cred => ({
      ...cred,
      isConnected: cred.isActive ? huaweiSSH.isConnected() : false
    }));
  }

  async getActiveOltCredential(): Promise<OltCredential | null> {
    const [credential] = await db.select().from(oltCredentials).where(eq(oltCredentials.isActive, true));
    return credential || null;
  }

  async createOltCredential(credential: InsertOltCredential): Promise<OltCredential> {
    // Deactivate all other credentials first
    await db.update(oltCredentials).set({ isActive: false });
    
    const [created] = await db.insert(oltCredentials).values({
      ...credential,
      isActive: true,
    }).returning();
    return created;
  }

  async updateOltCredential(id: number, updates: Partial<OltCredential>): Promise<OltCredential> {
    const [updated] = await db.update(oltCredentials)
      .set(updates)
      .where(eq(oltCredentials.id, id))
      .returning();
    return updated;
  }

  async deleteOltCredential(id: number): Promise<void> {
    await db.delete(oltCredentials).where(eq(oltCredentials.id, id));
  }

  async testOltConnection(id: number): Promise<{ success: boolean; message: string }> {
    const [credential] = await db.select().from(oltCredentials).where(eq(oltCredentials.id, id));
    if (!credential) {
      return { success: false, message: "OLT credential not found" };
    }

    try {
      // Disconnect any existing connection
      if (huaweiSSH.isConnected()) {
        huaweiSSH.disconnect();
      }

      // Decrypt password and connect via SSH
      const password = decryptOltPassword(credential.passwordEncrypted);
      const result = await huaweiSSH.connect({
        host: credential.host,
        port: credential.port,
        username: credential.username,
        password: password,
      });

      if (result.success) {
        // Mark as connected and set as active
        await db.update(oltCredentials).set({ isActive: false }).execute();
        await this.updateOltCredential(id, { 
          isConnected: true, 
          isActive: true,
          lastConnected: new Date() 
        });
        
        // Initialize refresh tracking for this credential
        const existing = await db.select().from(oltDataRefresh).where(eq(oltDataRefresh.oltCredentialId, id));
        if (existing.length === 0) {
          await db.insert(oltDataRefresh).values({ oltCredentialId: id });
        }
        
        // Auto-refresh data after successful connection
        console.log("[Storage] Automatically loading all OLT information...");
        this.refreshOltData().catch(err => {
          console.error("[Storage] Auto-refresh failed:", err.message);
        });

        return { success: true, message: "Connected to OLT successfully. Fetching data in background..." };
      } else {
        await this.updateOltCredential(id, { isConnected: false });
        return result;
      }
    } catch (error: any) {
      await this.updateOltCredential(id, { isConnected: false });
      return { success: false, message: `Connection failed: ${error.message}` };
    }
  }

  // Public method to refresh all OLT data from device and save to database
  async refreshOltData(): Promise<{ success: boolean; message: string }> {
    const credential = await this.getActiveOltCredential();
    if (!credential) {
      return { success: false, message: "No active OLT credential" };
    }

    if (!huaweiSSH.isConnected()) {
      // Try to reconnect
      const password = decryptOltPassword(credential.passwordEncrypted);
      const connectResult = await huaweiSSH.connect({
        host: credential.host,
        port: credential.port,
        username: credential.username,
        password: password,
      });
      if (!connectResult.success) {
        return { success: false, message: `Cannot connect to OLT: ${connectResult.message}` };
      }
    }

    // Wait for any ongoing refresh to complete
    if (this.refreshLock) {
      console.log("[Storage] Waiting for ongoing refresh to complete...");
      await this.refreshLock;
      return { success: true, message: "Refresh already in progress, data updated" };
    }
    
    // Mark refresh in progress
    await db.update(oltDataRefresh)
      .set({ refreshInProgress: true, lastError: null })
      .where(eq(oltDataRefresh.oltCredentialId, credential.id));
    
    // Create lock promise
    let unlock: () => void;
    this.refreshLock = new Promise(resolve => { unlock = resolve; });
    
    try {
      console.log("[Storage] Refreshing OLT data from device...");
      
      // Fetch VLANs first as they might be cached from initial connection
      const fetchedVlans = await huaweiSSH.getVlans();
      
      // Fetch all ONU data using unified method
      const { unbound, bound } = await huaweiSSH.getAllOnuData();
      
      // Fetch profiles
      const fetchedLineProfiles = await huaweiSSH.getLineProfiles();
      const fetchedServiceProfiles = await huaweiSSH.getServiceProfiles();
      
      // Save to database - clear old data first
      await db.delete(unboundOnus).where(eq(unboundOnus.oltCredentialId, credential.id));
      await db.delete(boundOnus).where(eq(boundOnus.oltCredentialId, credential.id));
      await db.delete(lineProfiles).where(eq(lineProfiles.oltCredentialId, credential.id));
      await db.delete(serviceProfiles).where(eq(serviceProfiles.oltCredentialId, credential.id));
      await db.delete(vlans).where(eq(vlans.oltCredentialId, credential.id));
      
      // Insert unbound ONUs
      if (unbound.length > 0) {
        await db.insert(unboundOnus).values(
          unbound.map(onu => ({
            serialNumber: onu.serialNumber,
            gponPort: onu.gponPort,
            discoveredAt: new Date(onu.discoveredAt),
            equipmentId: onu.equipmentId || null,
            softwareVersion: onu.softwareVersion || null,
            oltCredentialId: credential.id,
          }))
        );
      }
      
      // Insert bound ONUs
      if (bound.length > 0) {
        // Debug: log rxPower before saving
        bound.forEach(o => console.log(`[Storage] ONU ${o.serialNumber} rxPower=${o.rxPower}, txPower=${o.txPower}, desc="${o.description}"`));
        
        await db.insert(boundOnus).values(
          bound.map(onu => ({
            onuId: onu.onuId,
            serialNumber: onu.serialNumber,
            gponPort: onu.gponPort,
            description: onu.description || "",
            lineProfileId: onu.lineProfileId,
            serviceProfileId: onu.serviceProfileId,
            status: onu.status,
            configState: onu.configState,
            rxPower: onu.rxPower ?? null,
            txPower: onu.txPower ?? null,
            distance: onu.distance ?? null,
            vlanId: onu.vlanId ?? null,
            gemportId: onu.gemportId ?? null,
            oltCredentialId: credential.id,
            boundAt: new Date(onu.boundAt),
          }))
        );
      }
      
      // Insert line profiles
      if (fetchedLineProfiles.length > 0) {
        await db.insert(lineProfiles).values(
          fetchedLineProfiles.map(p => ({
            profileId: p.id,
            name: p.name,
            description: p.description || "",
            tcont: p.tcont || 0,
            gemportId: p.gemportId || 0,
            mappingMode: p.mappingMode || "",
            oltCredentialId: credential.id,
          }))
        );
      }
      
      // Insert service profiles
      if (fetchedServiceProfiles.length > 0) {
        await db.insert(serviceProfiles).values(
          fetchedServiceProfiles.map(p => ({
            profileId: p.id,
            name: p.name,
            description: p.description || "",
            portCount: p.portCount || 1,
            portType: p.portType || "eth",
            oltCredentialId: credential.id,
          }))
        );
      }
      
      // Insert VLANs
      if (fetchedVlans.length > 0) {
        await db.insert(vlans).values(
          fetchedVlans.map(v => ({
            vlanId: v.id,
            name: v.name,
            description: v.description || "",
            type: v.type,
            tagged: v.tagged,
            inUse: v.inUse,
            oltCredentialId: credential.id,
          }))
        );
      }
      
      // Update refresh tracking
      await db.update(oltDataRefresh)
        .set({ lastRefreshed: new Date(), refreshInProgress: false, lastError: null })
        .where(eq(oltDataRefresh.oltCredentialId, credential.id));
      
      console.log(`[Storage] Saved to DB: ${unbound.length} unbound, ${bound.length} bound ONUs`);
      console.log(`[Storage] Saved to DB: ${fetchedLineProfiles.length} line profiles, ${fetchedServiceProfiles.length} service profiles, ${fetchedVlans.length} VLANs`);
      
      return { 
        success: true, 
        message: `Refreshed: ${unbound.length} unbound, ${bound.length} bound ONUs, ${fetchedLineProfiles.length} profiles` 
      };
    } catch (error: any) {
      console.error("[Storage] Error refreshing OLT data:", error);
      
      // Update refresh tracking with error
      await db.update(oltDataRefresh)
        .set({ refreshInProgress: false, lastError: error.message })
        .where(eq(oltDataRefresh.oltCredentialId, credential.id));
      
      return { success: false, message: `Refresh failed: ${error.message}` };
    } finally {
      this.refreshLock = null;
      unlock!();
    }
  }

  // Refresh only unbound ONUs from OLT
  async refreshUnboundOnus(): Promise<{ success: boolean; message: string }> {
    const credential = await this.getActiveOltCredential();
    if (!credential) {
      return { success: false, message: "No active OLT credential" };
    }

    if (!huaweiSSH.isConnected()) {
      const password = decryptOltPassword(credential.passwordEncrypted);
      const connectResult = await huaweiSSH.connect({
        host: credential.host,
        port: credential.port,
        username: credential.username,
        password: password,
      });
      if (!connectResult.success) {
        return { success: false, message: `Cannot connect to OLT: ${connectResult.message}` };
      }
    }

    try {
      console.log("[Storage] Refreshing unbound ONUs from OLT...");
      const unboundList = await huaweiSSH.getUnboundOnus();
      
      // Clear old unbound data and insert new
      await db.delete(unboundOnus).where(eq(unboundOnus.oltCredentialId, credential.id));
      
      if (unboundList.length > 0) {
        await db.insert(unboundOnus).values(
          unboundList.map(onu => ({
            serialNumber: onu.serialNumber,
            gponPort: onu.gponPort,
            discoveredAt: new Date(onu.discoveredAt),
            equipmentId: onu.equipmentId || null,
            softwareVersion: onu.softwareVersion || null,
            oltCredentialId: credential.id,
          }))
        );
      }
      
      console.log(`[Storage] Refreshed ${unboundList.length} unbound ONUs`);
      return { success: true, message: `Found ${unboundList.length} unbound ONUs` };
    } catch (error: any) {
      console.error("[Storage] Error refreshing unbound ONUs:", error);
      return { success: false, message: `Refresh failed: ${error.message}` };
    }
  }

  // Refresh only bound ONUs from OLT
  async refreshBoundOnus(): Promise<{ success: boolean; message: string }> {
    const credential = await this.getActiveOltCredential();
    if (!credential) {
      return { success: false, message: "No active OLT credential" };
    }

    if (!huaweiSSH.isConnected()) {
      const password = decryptOltPassword(credential.passwordEncrypted);
      const connectResult = await huaweiSSH.connect({
        host: credential.host,
        port: credential.port,
        username: credential.username,
        password: password,
      });
      if (!connectResult.success) {
        return { success: false, message: `Cannot connect to OLT: ${connectResult.message}` };
      }
    }

    try {
      console.log("[Storage] Refreshing bound ONUs from OLT...");
      const boundList = await huaweiSSH.getBoundOnus();
      
      // Clear old bound data and insert new
      await db.delete(boundOnus).where(eq(boundOnus.oltCredentialId, credential.id));
      
      if (boundList.length > 0) {
        await db.insert(boundOnus).values(
          boundList.map(onu => ({
            onuId: onu.onuId,
            serialNumber: onu.serialNumber,
            gponPort: onu.gponPort,
            description: onu.description || "",
            lineProfileId: onu.lineProfileId,
            serviceProfileId: onu.serviceProfileId,
            status: onu.status,
            configState: onu.configState,
            rxPower: onu.rxPower ?? null,
            txPower: onu.txPower ?? null,
            distance: onu.distance ?? null,
            vlanId: onu.vlanId ?? null,
            gemportId: onu.gemportId ?? null,
            oltCredentialId: credential.id,
            boundAt: new Date(onu.boundAt),
          }))
        );
      }
      
      console.log(`[Storage] Refreshed ${boundList.length} bound ONUs`);
      return { success: true, message: `Found ${boundList.length} bound ONUs` };
    } catch (error: any) {
      console.error("[Storage] Error refreshing bound ONUs:", error);
      return { success: false, message: `Refresh failed: ${error.message}` };
    }
  }

  async getLastRefreshTime(): Promise<Date | null> {
    const credential = await this.getActiveOltCredential();
    if (!credential) return null;
    
    const [refresh] = await db.select().from(oltDataRefresh).where(eq(oltDataRefresh.oltCredentialId, credential.id));
    return refresh?.lastRefreshed || null;
  }

  async getRefreshStatus(): Promise<{ lastRefreshed: Date | null; inProgress: boolean; error: string | null }> {
    const credential = await this.getActiveOltCredential();
    if (!credential) {
      return { lastRefreshed: null, inProgress: false, error: "No active OLT" };
    }
    
    const [refresh] = await db.select().from(oltDataRefresh).where(eq(oltDataRefresh.oltCredentialId, credential.id));
    return {
      lastRefreshed: refresh?.lastRefreshed || null,
      inProgress: refresh?.refreshInProgress || false,
      error: refresh?.lastError || null,
    };
  }

  // OLT data operations - now read from database
  async getOltInfo(): Promise<OltInfo> {
    const credential = await this.getActiveOltCredential();
    if (!credential) {
      return {
        product: "Not Connected",
        version: "-",
        patch: "-",
        uptime: "-",
        connected: false,
      };
    }

    // If SSH is connected, get real OLT info
    if (huaweiSSH.isConnected()) {
      try {
        return await huaweiSSH.getOltInfo();
      } catch {
        // Fall through to return disconnected state
      }
    }

    return {
      product: credential.name,
      version: "-",
      patch: "-",
      uptime: "-",
      connected: false,
    };
  }

  async getUnboundOnus(): Promise<UnboundOnu[]> {
    const credential = await this.getActiveOltCredential();
    if (!credential) return [];
    
    const dbOnus = await db.select().from(unboundOnus)
      .where(eq(unboundOnus.oltCredentialId, credential.id));
    
    return dbOnus
      .map(onu => this.dbUnboundToApi(onu))
      .sort((a, b) => new Date(b.discoveredAt).getTime() - new Date(a.discoveredAt).getTime());
  }

  async getUnboundOnuCount(): Promise<number> {
    const credential = await this.getActiveOltCredential();
    if (!credential) return 0;
    
    const dbOnus = await db.select().from(unboundOnus)
      .where(eq(unboundOnus.oltCredentialId, credential.id));
    
    return dbOnus.length;
  }

  async getBoundOnus(): Promise<BoundOnu[]> {
    const credential = await this.getActiveOltCredential();
    if (!credential) return [];
    
    const dbOnus = await db.select().from(boundOnus)
      .where(eq(boundOnus.oltCredentialId, credential.id));
    
    return dbOnus
      .map(onu => this.dbBoundToApi(onu))
      .sort((a, b) => {
        if (a.gponPort !== b.gponPort) {
          return a.gponPort.localeCompare(b.gponPort);
        }
        return a.onuId - b.onuId;
      });
  }

  async getLineProfiles(): Promise<LineProfile[]> {
    const credential = await this.getActiveOltCredential();
    if (!credential) return [];
    
    const dbProfiles = await db.select().from(lineProfiles)
      .where(eq(lineProfiles.oltCredentialId, credential.id));
    
    return dbProfiles.map(p => this.dbLineProfileToApi(p));
  }

  async getServiceProfiles(): Promise<ServiceProfile[]> {
    const credential = await this.getActiveOltCredential();
    if (!credential) return [];
    
    const dbProfiles = await db.select().from(serviceProfiles)
      .where(eq(serviceProfiles.oltCredentialId, credential.id));
    
    return dbProfiles.map(p => this.dbServiceProfileToApi(p));
  }

  async getVlans(): Promise<Vlan[]> {
    const credential = await this.getActiveOltCredential();
    if (!credential) return [];
    
    const dbVlans = await db.select().from(vlans)
      .where(eq(vlans.oltCredentialId, credential.id));
    
    return dbVlans.map(v => this.dbVlanToApi(v)).sort((a, b) => a.id - b.id);
  }

  async validateOnu(serialNumber: string): Promise<{ canBind: boolean; reason: string }> {
    const sn = serialNumber.toUpperCase();
    const credential = await this.getActiveOltCredential();
    if (!credential) {
      return { canBind: false, reason: "No active OLT connection" };
    }
    
    // Check if already bound
    const [existingBound] = await db.select().from(boundOnus)
      .where(and(eq(boundOnus.oltCredentialId, credential.id), eq(boundOnus.serialNumber, sn)));
    if (existingBound) {
      return { canBind: false, reason: "ONU is already bound" };
    }
    
    // Check if in unbound list
    const [existingUnbound] = await db.select().from(unboundOnus)
      .where(and(eq(unboundOnus.oltCredentialId, credential.id), eq(unboundOnus.serialNumber, sn)));
    if (!existingUnbound) {
      return { canBind: false, reason: "ONU not found in autofind list" };
    }
    
    return { canBind: true, reason: "ONU is available for binding" };
  }

  async verifyOnu(serialNumber: string): Promise<OnuVerification> {
    const sn = serialNumber.toUpperCase();
    const credential = await this.getActiveOltCredential();
    
    if (credential) {
      // Check bound ONUs
      const [boundOnu] = await db.select().from(boundOnus)
        .where(and(eq(boundOnus.oltCredentialId, credential.id), eq(boundOnus.serialNumber, sn)));
      if (boundOnu) {
        return {
          serialNumber: sn,
          isUnbound: false,
          isBound: true,
          isOnline: boundOnu.status === "online",
          gponPort: boundOnu.gponPort,
          onuId: boundOnu.onuId,
          rxPower: boundOnu.rxPower ?? undefined,
          vlanAttached: boundOnu.vlanId !== null,
          message: `ONU is already bound as ONU ID ${boundOnu.onuId} on port ${boundOnu.gponPort}`,
        };
      }
      
      // Check unbound ONUs
      const [unboundOnu] = await db.select().from(unboundOnus)
        .where(and(eq(unboundOnus.oltCredentialId, credential.id), eq(unboundOnus.serialNumber, sn)));
      if (unboundOnu) {
        return {
          serialNumber: sn,
          isUnbound: true,
          isBound: false,
          isOnline: true,
          gponPort: unboundOnu.gponPort,
          message: "ONU is unconfigured and ready for binding",
        };
      }
    }
    
    return {
      serialNumber: sn,
      isUnbound: false,
      isBound: false,
      isOnline: false,
      message: "ONU not found in system. May be offline or not connected.",
    };
  }

  async getNextFreeOnuId(gponPort: string): Promise<number> {
    const credential = await this.getActiveOltCredential();
    if (!credential) throw new Error("No active OLT connection");
    
    const boundOnPort = await db.select().from(boundOnus)
      .where(and(eq(boundOnus.oltCredentialId, credential.id), eq(boundOnus.gponPort, gponPort)));
    
    const usedIds = boundOnPort.map(onu => onu.onuId);
    
    for (let i = 0; i <= 127; i++) {
      if (!usedIds.includes(i)) {
        return i;
      }
    }
    
    throw new Error("No free ONU ID available on this port");
  }

  async bindOnu(request: BindOnuRequest): Promise<BoundOnu> {
    const credential = await this.getActiveOltCredential();
    if (!credential) {
      throw new Error("Not connected to OLT");
    }

    const sn = request.serialNumber.toUpperCase();
    
    const validation = await this.validateOnu(sn);
    if (!validation.canBind) {
      throw new Error(validation.reason);
    }
    
    // Get profiles from database
    const dbLineProfiles = await this.getLineProfiles();
    const dbServiceProfiles = await this.getServiceProfiles();
    const dbVlans = await this.getVlans();
    
    const lineProfile = dbLineProfiles.find(p => p.id === request.lineProfileId);
    if (!lineProfile) {
      throw new Error("Line profile does not exist");
    }
    
    const serviceProfile = dbServiceProfiles.find(p => p.id === request.serviceProfileId);
    if (!serviceProfile) {
      throw new Error("Service profile does not exist");
    }
    
    if (request.vlanId) {
      const vlan = dbVlans.find(v => v.id === request.vlanId);
      if (!vlan) {
        throw new Error("VLAN does not exist");
      }
    }
    
    const onuId = await this.getNextFreeOnuId(request.gponPort);
    const vlanId = request.vlanId || 200;
    
    // Insert into database FIRST (fast response)
    // SSH commands will run in background
    const [newBoundOnu] = await db.insert(boundOnus).values({
      onuId,
      serialNumber: sn,
      gponPort: request.gponPort,
      description: request.description,
      lineProfileId: request.lineProfileId,
      serviceProfileId: request.serviceProfileId,
      status: "online",
      configState: "normal",
      rxPower: null,
      txPower: null,
      distance: null,
      vlanId,
      gemportId: lineProfile.gemportId,
      pppoeUsername: request.pppoeUsername || null,
      pppoePassword: request.pppoePassword || null,
      oltCredentialId: credential.id,
      boundAt: new Date(),
    }).returning();
    
    // Mark VLAN as in use
    await db.update(vlans)
      .set({ inUse: true })
      .where(and(eq(vlans.oltCredentialId, credential.id), eq(vlans.vlanId, vlanId)));
    
    // Execute SSH commands in BACKGROUND (don't await - let it run async)
    if (huaweiSSH.isConnected()) {
      const credentialId = credential.id;
      const boundOnuId = newBoundOnu.id;
      
      // Run SSH bind and optical update in background
      (async () => {
        try {
          console.log(`[Storage] Starting background SSH bind for ONU ${sn}...`);
          
          const bindResult = await huaweiSSH.bindOnu({
            serialNumber: sn,
            gponPort: request.gponPort,
            onuId,
            lineProfileName: lineProfile.name,
            serviceProfileName: serviceProfile.name,
            description: request.description,
            vlanId,
            pppoeUsername: request.pppoeUsername,
            pppoePassword: request.pppoePassword,
          });
          
          if (bindResult.success) {
            console.log(`[Storage] SSH bind successful for ONU ${sn}`);
            
            // Only remove from unbound list AFTER successful bind
            await db.delete(unboundOnus)
              .where(and(eq(unboundOnus.oltCredentialId, credentialId), eq(unboundOnus.serialNumber, sn)));
            console.log(`[Storage] Removed ${sn} from unbound list`);
            
            // Wait a moment for ONU to come online, then get optical info
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            // Get optical power info
            const opticalInfo = await huaweiSSH.getOnuOpticalInfo(request.gponPort, onuId);
            if (opticalInfo) {
              await db.update(boundOnus)
                .set({
                  rxPower: opticalInfo.rxPower ?? null,
                  txPower: opticalInfo.txPower ?? null,
                  distance: opticalInfo.distance ?? null,
                  status: "online",
                })
                .where(eq(boundOnus.id, boundOnuId));
              console.log(`[Storage] Updated optical info for ONU ${sn}`);
            }
          } else {
            console.error(`[Storage] SSH bind failed for ONU ${sn}: ${bindResult.message}`);
            // Delete from bound list since bind failed - ONU stays in unbound list
            await db.delete(boundOnus).where(eq(boundOnus.id, boundOnuId));
            // Release VLAN
            await db.update(vlans)
              .set({ inUse: false })
              .where(and(eq(vlans.oltCredentialId, credentialId), eq(vlans.vlanId, vlanId)));
            console.log(`[Storage] Reverted bind for ONU ${sn} - still in unbound list`);
          }
        } catch (error) {
          console.error(`[Storage] Background SSH bind error for ONU ${sn}:`, error);
          // On error, revert - delete from bound, keep in unbound
          await db.delete(boundOnus).where(eq(boundOnus.id, boundOnuId));
          await db.update(vlans)
            .set({ inUse: false })
            .where(and(eq(vlans.oltCredentialId, credentialId), eq(vlans.vlanId, vlanId)));
        }
      })();
    } else {
      // No SSH connection - remove from unbound list anyway (manual config assumed)
      await db.delete(unboundOnus)
        .where(and(eq(unboundOnus.oltCredentialId, credential.id), eq(unboundOnus.serialNumber, sn)));
    }
    
    return this.dbBoundToApi(newBoundOnu);
  }

  async unbindOnu(onuId: number, gponPort: string, cleanConfig: boolean): Promise<void> {
    const credential = await this.getActiveOltCredential();
    if (!credential) {
      throw new Error("Not connected to OLT");
    }

    const [onu] = await db.select().from(boundOnus)
      .where(and(
        eq(boundOnus.oltCredentialId, credential.id),
        eq(boundOnus.onuId, onuId),
        eq(boundOnus.gponPort, gponPort)
      ));
    
    if (!onu) {
      throw new Error("ONU not found");
    }
    
    // Execute SSH commands to unbind ONU on OLT device
    const result = await huaweiSSH.unbindOnu(onuId, gponPort, cleanConfig);
    if (!result.success) {
      throw new Error(result.message);
    }
    
    // Remove from bound list in database
    await db.delete(boundOnus)
      .where(and(
        eq(boundOnus.oltCredentialId, credential.id),
        eq(boundOnus.onuId, onuId),
        eq(boundOnus.gponPort, gponPort)
      ));
    
    // Note: The ONU should appear in autofind on the OLT automatically
    // We'll pick it up on the next unbound refresh
  }
}

export const storage = new DatabaseStorage();
