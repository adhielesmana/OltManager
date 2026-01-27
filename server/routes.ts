import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { bindOnuRequestSchema, unbindOnuRequestSchema } from "@shared/schema";
import { z } from "zod";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.get("/api/olt/info", async (req, res) => {
    try {
      const info = await storage.getOltInfo();
      res.json(info);
    } catch (error) {
      res.status(500).json({ error: "Failed to get OLT info" });
    }
  });

  app.get("/api/onu/unbound", async (req, res) => {
    try {
      const onus = await storage.getUnboundOnus();
      res.json(onus);
    } catch (error) {
      res.status(500).json({ error: "Failed to get unbound ONUs" });
    }
  });

  app.get("/api/onu/unbound/count", async (req, res) => {
    try {
      const count = await storage.getUnboundOnuCount();
      res.json({ count });
    } catch (error) {
      res.status(500).json({ error: "Failed to get unbound count" });
    }
  });

  app.get("/api/onu/bound", async (req, res) => {
    try {
      const onus = await storage.getBoundOnus();
      res.json(onus);
    } catch (error) {
      res.status(500).json({ error: "Failed to get bound ONUs" });
    }
  });

  app.get("/api/profiles/line", async (req, res) => {
    try {
      const profiles = await storage.getLineProfiles();
      res.json(profiles);
    } catch (error) {
      res.status(500).json({ error: "Failed to get line profiles" });
    }
  });

  app.get("/api/profiles/service", async (req, res) => {
    try {
      const profiles = await storage.getServiceProfiles();
      res.json(profiles);
    } catch (error) {
      res.status(500).json({ error: "Failed to get service profiles" });
    }
  });

  app.get("/api/vlans", async (req, res) => {
    try {
      const vlans = await storage.getVlans();
      res.json(vlans);
    } catch (error) {
      res.status(500).json({ error: "Failed to get VLANs" });
    }
  });

  app.post("/api/onu/validate", async (req, res) => {
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

  app.get("/api/onu/verify/:serialNumber", async (req, res) => {
    try {
      const { serialNumber } = req.params;
      const result = await storage.verifyOnu(serialNumber);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to verify ONU" });
    }
  });

  app.post("/api/onu/bind", async (req, res) => {
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

  app.post("/api/onu/unbind", async (req, res) => {
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
