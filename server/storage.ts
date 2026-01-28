import { randomUUID } from "crypto";
import { eq, and } from "drizzle-orm";
import { db } from "./db";
import {
  users,
  sessions,
  oltCredentials,
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
  
  // OLT data operations (from OLT device)
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
  // In-memory cache for OLT data (fetched from OLT device)
  private unboundOnus: Map<string, UnboundOnu> = new Map();
  private boundOnus: Map<string, BoundOnu> = new Map();
  private lineProfiles: LineProfile[] = [];
  private serviceProfiles: ServiceProfile[] = [];
  private vlans: Vlan[] = [];
  private oltConnected: boolean = false;

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
    return db.select().from(oltCredentials);
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
        this.oltConnected = true;
        
        // Fetch and cache initial data from OLT
        await this.refreshOltData();
        
        return { success: true, message: "Connected to OLT successfully" };
      } else {
        await this.updateOltCredential(id, { isConnected: false });
        this.oltConnected = false;
        return result;
      }
    } catch (error: any) {
      await this.updateOltCredential(id, { isConnected: false });
      this.oltConnected = false;
      return { success: false, message: `Connection failed: ${error.message}` };
    }
  }

  private async refreshOltData(): Promise<void> {
    if (!huaweiSSH.isConnected()) return;
    
    try {
      console.log("[Storage] Refreshing OLT data...");
      
      // Fetch unbound ONUs
      const unboundList = await huaweiSSH.getUnboundOnus();
      this.unboundOnus.clear();
      unboundList.forEach(onu => this.unboundOnus.set(onu.serialNumber, onu));
      
      // Fetch bound ONUs
      const boundList = await huaweiSSH.getBoundOnus();
      this.boundOnus.clear();
      boundList.forEach(onu => this.boundOnus.set(onu.serialNumber, onu));
      
      // Fetch profiles
      this.lineProfiles = await huaweiSSH.getLineProfiles();
      this.serviceProfiles = await huaweiSSH.getServiceProfiles();
      
      // Fetch VLANs
      this.vlans = await huaweiSSH.getVlans();
      
      console.log(`[Storage] Loaded: ${this.unboundOnus.size} unbound, ${this.boundOnus.size} bound ONUs`);
      console.log(`[Storage] Loaded: ${this.lineProfiles.length} line profiles, ${this.serviceProfiles.length} service profiles`);
      console.log(`[Storage] Loaded: ${this.vlans.length} VLANs`);
    } catch (error) {
      console.error("[Storage] Error refreshing OLT data:", error);
    }
  }

  // OLT data operations
  async getOltInfo(): Promise<OltInfo> {
    const credential = await this.getActiveOltCredential();
    if (!credential || !credential.isConnected || !huaweiSSH.isConnected()) {
      return {
        product: "Not Connected",
        version: "-",
        patch: "-",
        uptime: "-",
        connected: false,
      };
    }

    // Get real OLT info via SSH
    return await huaweiSSH.getOltInfo();
  }

  async getUnboundOnus(): Promise<UnboundOnu[]> {
    const credential = await this.getActiveOltCredential();
    if (!credential || !credential.isConnected || !huaweiSSH.isConnected()) {
      return [];
    }
    
    // Refresh unbound ONU data from OLT
    try {
      const unboundList = await huaweiSSH.getUnboundOnus();
      this.unboundOnus.clear();
      unboundList.forEach(onu => this.unboundOnus.set(onu.serialNumber, onu));
    } catch (error) {
      console.error("[Storage] Error fetching unbound ONUs:", error);
    }
    
    return Array.from(this.unboundOnus.values()).sort(
      (a, b) => new Date(b.discoveredAt).getTime() - new Date(a.discoveredAt).getTime()
    );
  }

  async getUnboundOnuCount(): Promise<number> {
    const credential = await this.getActiveOltCredential();
    if (!credential || !credential.isConnected || !huaweiSSH.isConnected()) {
      return 0;
    }
    return this.unboundOnus.size;
  }

  async getBoundOnus(): Promise<BoundOnu[]> {
    const credential = await this.getActiveOltCredential();
    if (!credential || !credential.isConnected || !huaweiSSH.isConnected()) {
      return [];
    }
    
    // Refresh bound ONU data from OLT
    try {
      const boundList = await huaweiSSH.getBoundOnus();
      this.boundOnus.clear();
      boundList.forEach(onu => this.boundOnus.set(onu.serialNumber, onu));
    } catch (error) {
      console.error("[Storage] Error fetching bound ONUs:", error);
    }
    
    return Array.from(this.boundOnus.values()).sort((a, b) => {
      if (a.gponPort !== b.gponPort) {
        return a.gponPort.localeCompare(b.gponPort);
      }
      return a.onuId - b.onuId;
    });
  }

  async getLineProfiles(): Promise<LineProfile[]> {
    const credential = await this.getActiveOltCredential();
    if (!credential || !credential.isConnected || !huaweiSSH.isConnected()) {
      return [];
    }
    
    // Refresh if empty
    if (this.lineProfiles.length === 0) {
      try {
        this.lineProfiles = await huaweiSSH.getLineProfiles();
      } catch (error) {
        console.error("[Storage] Error fetching line profiles:", error);
      }
    }
    
    return this.lineProfiles;
  }

  async getServiceProfiles(): Promise<ServiceProfile[]> {
    const credential = await this.getActiveOltCredential();
    if (!credential || !credential.isConnected || !huaweiSSH.isConnected()) {
      return [];
    }
    
    // Refresh if empty
    if (this.serviceProfiles.length === 0) {
      try {
        this.serviceProfiles = await huaweiSSH.getServiceProfiles();
      } catch (error) {
        console.error("[Storage] Error fetching service profiles:", error);
      }
    }
    
    return this.serviceProfiles;
  }

  async getVlans(): Promise<Vlan[]> {
    const credential = await this.getActiveOltCredential();
    if (!credential || !credential.isConnected || !huaweiSSH.isConnected()) {
      return [];
    }
    
    // Refresh if empty
    if (this.vlans.length === 0) {
      try {
        this.vlans = await huaweiSSH.getVlans();
      } catch (error) {
        console.error("[Storage] Error fetching VLANs:", error);
      }
    }
    
    return this.vlans.sort((a, b) => a.id - b.id);
  }

  async validateOnu(serialNumber: string): Promise<{ canBind: boolean; reason: string }> {
    const sn = serialNumber.toUpperCase();
    
    if (this.boundOnus.has(sn)) {
      return { canBind: false, reason: "ONU is already bound" };
    }
    
    if (!this.unboundOnus.has(sn)) {
      return { canBind: false, reason: "ONU not found in autofind list" };
    }
    
    return { canBind: true, reason: "ONU is available for binding" };
  }

  async verifyOnu(serialNumber: string): Promise<OnuVerification> {
    const sn = serialNumber.toUpperCase();
    
    const boundOnu = this.boundOnus.get(sn);
    if (boundOnu) {
      return {
        serialNumber: sn,
        isUnbound: false,
        isBound: true,
        isOnline: boundOnu.status === "online",
        gponPort: boundOnu.gponPort,
        onuId: boundOnu.onuId,
        rxPower: boundOnu.rxPower,
        vlanAttached: boundOnu.vlanId !== undefined,
        message: `ONU is already bound as ONU ID ${boundOnu.onuId} on port ${boundOnu.gponPort}`,
      };
    }
    
    const unboundOnu = this.unboundOnus.get(sn);
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
    
    return {
      serialNumber: sn,
      isUnbound: false,
      isBound: false,
      isOnline: false,
      message: "ONU not found in system. May be offline or not connected.",
    };
  }

  async getNextFreeOnuId(gponPort: string): Promise<number> {
    const boundOnPort = Array.from(this.boundOnus.values())
      .filter(onu => onu.gponPort === gponPort)
      .map(onu => onu.onuId);
    
    for (let i = 0; i <= 127; i++) {
      if (!boundOnPort.includes(i)) {
        return i;
      }
    }
    
    throw new Error("No free ONU ID available on this port");
  }

  async bindOnu(request: BindOnuRequest): Promise<BoundOnu> {
    const credential = await this.getActiveOltCredential();
    if (!credential || !credential.isConnected) {
      throw new Error("Not connected to OLT");
    }

    const sn = request.serialNumber.toUpperCase();
    
    const validation = await this.validateOnu(sn);
    if (!validation.canBind) {
      throw new Error(validation.reason);
    }
    
    const lineProfile = this.lineProfiles.find(p => p.id === request.lineProfileId);
    if (!lineProfile) {
      throw new Error("Line profile does not exist");
    }
    
    const serviceProfile = this.serviceProfiles.find(p => p.id === request.serviceProfileId);
    if (!serviceProfile) {
      throw new Error("Service profile does not exist");
    }
    
    if (request.vlanId) {
      const vlan = this.vlans.find(v => v.id === request.vlanId);
      if (!vlan) {
        throw new Error("VLAN does not exist");
      }
    }
    
    const onuId = await this.getNextFreeOnuId(request.gponPort);
    
    const vlanId = request.vlanId || 200;
    const vlanIndex = this.vlans.findIndex(v => v.id === vlanId);
    if (vlanIndex !== -1) {
      this.vlans[vlanIndex].inUse = true;
    }
    
    // In production, execute SSH commands to bind ONU on OLT
    const boundOnu: BoundOnu = {
      id: randomUUID(),
      onuId,
      serialNumber: sn,
      gponPort: request.gponPort,
      description: request.description,
      lineProfileId: request.lineProfileId,
      serviceProfileId: request.serviceProfileId,
      status: "online",
      configState: "normal",
      rxPower: -18 - Math.random() * 10,
      txPower: 1.5 + Math.random(),
      distance: Math.floor(500 + Math.random() * 4000),
      boundAt: new Date().toISOString(),
      vlanId,
      gemportId: lineProfile.gemportId,
    };
    
    this.unboundOnus.delete(sn);
    this.boundOnus.set(sn, boundOnu);
    
    return boundOnu;
  }

  async unbindOnu(onuId: number, gponPort: string, cleanConfig: boolean): Promise<void> {
    const credential = await this.getActiveOltCredential();
    if (!credential || !credential.isConnected) {
      throw new Error("Not connected to OLT");
    }

    const onu = Array.from(this.boundOnus.values()).find(
      o => o.onuId === onuId && o.gponPort === gponPort
    );
    
    if (!onu) {
      throw new Error("ONU not found");
    }
    
    // In production, execute SSH commands to unbind ONU on OLT
    this.boundOnus.delete(onu.serialNumber);
    
    if (!cleanConfig) {
      const unboundOnu: UnboundOnu = {
        id: randomUUID(),
        serialNumber: onu.serialNumber,
        gponPort: onu.gponPort,
        discoveredAt: new Date().toISOString(),
        equipmentId: "Unknown",
      };
      this.unboundOnus.set(onu.serialNumber, unboundOnu);
    }
  }
}

export const storage = new DatabaseStorage();
