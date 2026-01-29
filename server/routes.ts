import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { huaweiSSH } from "./huawei-ssh";
import { 
  bindOnuRequestSchema, 
  unbindOnuRequestSchema, 
  loginRequestSchema,
  createUserRequestSchema,
  oltCredentialRequestSchema,
} from "@shared/schema";
import { hashPassword, hasPermission, canManageUser, encryptOltPassword } from "./auth";
import type { UserRole } from "@shared/schema";

// Session middleware
declare global {
  namespace Express {
    interface Request {
      session?: {
        userId: number;
        username: string;
        role: UserRole;
      };
    }
  }
}

// Health check endpoint (no auth required)
function healthCheck(req: Request, res: Response) {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
}

// Auth middleware
async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const sessionId = req.headers["x-session-id"] as string;
  
  if (!sessionId) {
    return res.status(401).json({ error: "Authentication required" });
  }
  
  const session = await storage.getSession(sessionId);
  if (!session) {
    return res.status(401).json({ error: "Invalid or expired session" });
  }
  
  req.session = {
    userId: session.userId,
    username: session.username,
    role: session.role as UserRole,
  };
  
  next();
}

// Permission middleware factory
function requirePermission(action: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.session) {
      return res.status(401).json({ error: "Authentication required" });
    }
    
    if (!hasPermission(req.session.role, action)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    
    next();
  };
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // ==================== HEALTH CHECK ====================
  app.get("/api/health", healthCheck);

  // ==================== AUTH ROUTES ====================
  
  app.post("/api/auth/login", async (req, res) => {
    try {
      const parseResult = loginRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: "Invalid credentials format" });
      }
      
      const { username, password } = parseResult.data;
      const user = await storage.authenticateUser(username, password);
      
      if (!user) {
        return res.status(401).json({ error: "Invalid username or password" });
      }
      
      const session = await storage.createSession(user.id, user.username, user.role);
      
      res.json({
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          email: user.email,
        },
        sessionId: session.id,
      });
    } catch (error) {
      res.status(500).json({ error: "Login failed" });
    }
  });
  
  app.post("/api/auth/logout", async (req, res) => {
    try {
      const sessionId = req.headers["x-session-id"] as string;
      if (sessionId) {
        await storage.deleteSession(sessionId);
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Logout failed" });
    }
  });
  
  app.get("/api/auth/me", requireAuth, async (req, res) => {
    res.json({
      id: req.session!.userId,
      username: req.session!.username,
      role: req.session!.role,
    });
  });

  // ==================== USER MANAGEMENT ROUTES ====================
  
  app.get("/api/users", requireAuth, requirePermission("user:view"), async (req, res) => {
    try {
      const users = await storage.getUsers();
      res.json(users.map(u => ({
        id: u.id,
        username: u.username,
        role: u.role,
        email: u.email,
        createdAt: u.createdAt,
      })));
    } catch (error) {
      res.status(500).json({ error: "Failed to get users" });
    }
  });
  
  app.post("/api/users", requireAuth, requirePermission("user:create"), async (req, res) => {
    try {
      const parseResult = createUserRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: "Invalid user data", details: parseResult.error.format() });
      }
      
      const { username, password, role, email } = parseResult.data;
      
      // Check if username already exists
      const existing = await storage.getUserByUsername(username);
      if (existing) {
        return res.status(400).json({ error: "Username already exists" });
      }
      
      // Admin cannot create other admins
      if (req.session!.role === "admin" && role === "admin") {
        return res.status(403).json({ error: "Admins cannot create other admin accounts" });
      }
      
      const passwordHash = await hashPassword(password);
      const user = await storage.createUser({
        username,
        passwordHash,
        role,
        email: email || null,
        createdBy: req.session!.userId,
        isActive: true,
      });
      
      res.json({
        id: user.id,
        username: user.username,
        role: user.role,
        email: user.email,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to create user" });
    }
  });
  
  app.delete("/api/users/:id", requireAuth, requirePermission("user:delete"), async (req, res) => {
    try {
      const userId = parseInt(String(req.params.id));
      const targetUser = await storage.getUserById(userId);
      
      if (!targetUser) {
        return res.status(404).json({ error: "User not found" });
      }
      
      // Check if actor can manage target user
      if (!canManageUser(req.session!.role, targetUser.role as UserRole, "delete")) {
        return res.status(403).json({ error: "Cannot delete this user" });
      }
      
      await storage.deleteUser(userId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete user" });
    }
  });

  // Update user (super_admin only)
  app.patch("/api/users/:id", requireAuth, async (req, res) => {
    try {
      // Only super_admin can edit users
      if (req.session!.role !== "super_admin") {
        return res.status(403).json({ error: "Only super admin can modify users" });
      }

      const userId = parseInt(String(req.params.id));
      const targetUser = await storage.getUserById(userId);
      
      if (!targetUser) {
        return res.status(404).json({ error: "User not found" });
      }

      // Cannot modify the hardcoded super admin's role
      if (targetUser.username === "adhielesmana" && req.body.role && req.body.role !== "super_admin") {
        return res.status(403).json({ error: "Cannot change role of the primary super admin" });
      }

      const updates: { username?: string; password?: string; role?: string; email?: string | null } = {};
      
      if (req.body.username && req.body.username !== targetUser.username) {
        // Check if username is already taken
        const existingUser = await storage.getUserByUsername(req.body.username);
        if (existingUser) {
          return res.status(400).json({ error: "Username already taken" });
        }
        updates.username = req.body.username;
      }

      if (req.body.password) {
        updates.password = await hashPassword(req.body.password);
      }

      if (req.body.role) {
        updates.role = req.body.role;
      }

      if (req.body.email !== undefined) {
        updates.email = req.body.email || null;
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "No updates provided" });
      }

      await storage.updateUser(userId, updates);
      res.json({ success: true });
    } catch (error) {
      console.error("Failed to update user:", error);
      res.status(500).json({ error: "Failed to update user" });
    }
  });

  // ==================== OLT CREDENTIAL ROUTES ====================
  
  app.get("/api/olt/credentials", requireAuth, requirePermission("olt:view"), async (req, res) => {
    try {
      const credentials = await storage.getOltCredentials();
      res.json(credentials.map(c => ({
        id: c.id,
        name: c.name,
        host: c.host,
        port: c.port,
        username: c.username,
        protocol: c.protocol,
        isActive: c.isActive,
        isConnected: c.isConnected,
        lastConnected: c.lastConnected,
      })));
    } catch (error) {
      res.status(500).json({ error: "Failed to get OLT credentials" });
    }
  });
  
  app.post("/api/olt/credentials", requireAuth, requirePermission("olt:configure"), async (req, res) => {
    try {
      const parseResult = oltCredentialRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: "Invalid OLT credential data", details: parseResult.error.format() });
      }
      
      const { name, host, port, username, password, protocol } = parseResult.data;
      const passwordEncrypted = encryptOltPassword(password);
      
      const credential = await storage.createOltCredential({
        name,
        host,
        port,
        username,
        passwordEncrypted,
        protocol,
        isActive: true,
        createdBy: req.session!.userId,
      });
      
      res.json({
        id: credential.id,
        name: credential.name,
        host: credential.host,
        port: credential.port,
        username: credential.username,
        protocol: credential.protocol,
        isActive: credential.isActive,
        isConnected: credential.isConnected,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to create OLT credential" });
    }
  });
  
  app.post("/api/olt/connect/:id", requireAuth, requirePermission("olt:configure"), async (req, res) => {
    try {
      const id = parseInt(String(req.params.id));
      const result = await storage.testOltConnection(id);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to connect to OLT" });
    }
  });
  
  app.patch("/api/olt/credentials/:id", requireAuth, requirePermission("olt:configure"), async (req, res) => {
    try {
      const id = parseInt(String(req.params.id));
      const { name, host, port, username, password, protocol } = req.body;
      
      const updates: any = {};
      if (name !== undefined) updates.name = name;
      if (host !== undefined) updates.host = host;
      if (port !== undefined) updates.port = port;
      if (username !== undefined) updates.username = username;
      if (password !== undefined) updates.password = password;
      if (protocol !== undefined) updates.protocol = protocol;
      
      const updated = await storage.updateOltCredential(id, updates);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to update OLT credential" });
    }
  });

  app.delete("/api/olt/credentials/:id", requireAuth, requirePermission("olt:configure"), async (req, res) => {
    try {
      const id = parseInt(String(req.params.id));
      await storage.deleteOltCredential(id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete OLT credential" });
    }
  });

  // ==================== OLT DATA ROUTES (require auth) ====================

  app.post("/api/olt/refresh", requireAuth, requirePermission("olt:configure"), async (req, res) => {
    try {
      const result = await storage.refreshOltData();
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || "Failed to refresh OLT data" });
    }
  });

  app.get("/api/olt/refresh/status", requireAuth, async (req, res) => {
    try {
      const status = await storage.getRefreshStatus();
      res.json(status);
    } catch (error) {
      res.status(500).json({ lastRefreshed: null, inProgress: false, error: "Failed to get refresh status" });
    }
  });

  app.get("/api/olt/info", requireAuth, async (req, res) => {
    try {
      const info = await storage.getOltInfo();
      res.json(info);
    } catch (error) {
      res.status(500).json({ error: "Failed to get OLT info" });
    }
  });

  app.get("/api/onu/unbound", requireAuth, requirePermission("onu:view"), async (req, res) => {
    try {
      const onus = await storage.getUnboundOnus();
      res.json(onus);
    } catch (error) {
      res.status(500).json({ error: "Failed to get unbound ONUs" });
    }
  });

  app.get("/api/onu/unbound/count", requireAuth, async (req, res) => {
    try {
      const count = await storage.getUnboundOnuCount();
      res.json({ count });
    } catch (error) {
      res.status(500).json({ error: "Failed to get unbound count" });
    }
  });

  // Refresh unbound ONUs directly from OLT
  app.post("/api/onu/unbound/refresh", requireAuth, requirePermission("onu:view"), async (req, res) => {
    try {
      const result = await storage.refreshUnboundOnus();
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, message: "Failed to refresh unbound ONUs" });
    }
  });

  app.get("/api/onu/bound", requireAuth, requirePermission("onu:view"), async (req, res) => {
    try {
      const onus = await storage.getBoundOnus();
      res.json(onus);
    } catch (error) {
      res.status(500).json({ error: "Failed to get bound ONUs" });
    }
  });

  // Refresh bound ONUs directly from OLT
  app.post("/api/onu/bound/refresh", requireAuth, requirePermission("onu:view"), async (req, res) => {
    try {
      const result = await storage.refreshBoundOnus();
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, message: "Failed to refresh bound ONUs" });
    }
  });

  app.get("/api/profiles/line", requireAuth, requirePermission("profiles:view"), async (req, res) => {
    try {
      const profiles = await storage.getLineProfiles();
      res.json(profiles);
    } catch (error) {
      res.status(500).json({ error: "Failed to get line profiles" });
    }
  });

  app.get("/api/profiles/service", requireAuth, requirePermission("profiles:view"), async (req, res) => {
    try {
      const profiles = await storage.getServiceProfiles();
      res.json(profiles);
    } catch (error) {
      res.status(500).json({ error: "Failed to get service profiles" });
    }
  });

  app.get("/api/vlans", requireAuth, requirePermission("vlans:view"), async (req, res) => {
    try {
      const vlans = await storage.getVlans();
      res.json(vlans);
    } catch (error) {
      res.status(500).json({ error: "Failed to get VLANs" });
    }
  });

  // Get available GPON ports from OLT via SSH
  app.get("/api/gpon-ports", requireAuth, requirePermission("onu:view"), async (req, res) => {
    // Fallback to 16 ports (2 slots x 8 ports each) as default
    const defaultPorts = [
      "0/1/0", "0/1/1", "0/1/2", "0/1/3", "0/1/4", "0/1/5", "0/1/6", "0/1/7",
      "0/2/0", "0/2/1", "0/2/2", "0/2/3", "0/2/4", "0/2/5", "0/2/6", "0/2/7"
    ];
    
    try {
      // Try to get ports from SSH if connected
      const sshPorts = await huaweiSSH.getGponPorts();
      
      if (sshPorts.length > 0) {
        res.json(sshPorts);
      } else {
        res.json(defaultPorts);
      }
    } catch (error) {
      // On any error, return default ports
      console.error("[Routes] Error getting GPON ports:", error);
      res.json(defaultPorts);
    }
  });

  // Get next free ONU ID for a given port
  app.get("/api/onu/next-id/:port", requireAuth, requirePermission("onu:view"), async (req, res) => {
    try {
      const portParam = req.params.port as string;
      const port = portParam.replace(/-/g, "/"); // Convert 0-1-0 to 0/1/0
      const nextId = await storage.getNextFreeOnuId(port);
      res.json({ nextId, maxId: 127 });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to get next ONU ID" });
    }
  });

  app.post("/api/onu/validate", requireAuth, requirePermission("onu:bind"), async (req, res) => {
    try {
      const { serialNumber } = req.body;
      if (!serialNumber || typeof serialNumber !== "string") {
        return res.status(400).json({ error: "Serial number is required" });
      }
      const result = await storage.validateOnu(serialNumber);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to validate ONU" });
    }
  });

  app.get("/api/onu/verify/:serialNumber", requireAuth, requirePermission("onu:view"), async (req, res) => {
    try {
      const serialNumber = String(req.params.serialNumber);
      const result = await storage.verifyOnu(serialNumber);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to verify ONU" });
    }
  });

  app.post("/api/onu/bind", requireAuth, requirePermission("onu:bind"), async (req, res) => {
    try {
      const parseResult = bindOnuRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ 
          error: "Invalid request", 
          details: parseResult.error.format() 
        });
      }

      const boundOnu = await storage.bindOnu(parseResult.data);
      res.json(boundOnu);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to bind ONU";
      res.status(400).json({ error: message });
    }
  });

  app.post("/api/onu/unbind", requireAuth, requirePermission("onu:unbind"), async (req, res) => {
    try {
      const parseResult = unbindOnuRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ 
          error: "Invalid request", 
          details: parseResult.error.format() 
        });
      }

      await storage.unbindOnu(
        parseResult.data.onuId,
        parseResult.data.gponPort,
        parseResult.data.cleanConfig
      );
      res.json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to unbind ONU";
      res.status(400).json({ error: message });
    }
  });

  return httpServer;
}
