import { Client, ClientChannel } from "ssh2";
import type { UnboundOnu, BoundOnu, LineProfile, ServiceProfile, Vlan, OltInfo } from "@shared/schema";

export interface HuaweiSSHConfig {
  host: string;
  port: number;
  username: string;
  password: string;
}

export class HuaweiSSH {
  private client: Client | null = null;
  private config: HuaweiSSHConfig | null = null;
  private connected: boolean = false;
  private shell: ClientChannel | null = null;
  private commandQueue: Array<{
    command: string;
    resolve: (output: string) => void;
    reject: (error: Error) => void;
  }> = [];
  private isExecuting: boolean = false;
  private shellBuffer: string = "";
  private currentResolve: ((output: string) => void) | null = null;
  private commandTimeout: NodeJS.Timeout | null = null;

  async connect(config: HuaweiSSHConfig): Promise<{ success: boolean; message: string }> {
    return new Promise((resolve) => {
      this.config = config;
      this.client = new Client();

      const timeout = setTimeout(() => {
        this.client?.end();
        resolve({ success: false, message: "Connection timeout" });
      }, 30000);

      this.client.on("ready", async () => {
        clearTimeout(timeout);
        this.connected = true;
        console.log(`[SSH] Connected to OLT at ${config.host}`);
        
        // Open persistent shell
        try {
          await this.openShell();
          resolve({ success: true, message: "Connected to OLT successfully" });
        } catch (err: any) {
          resolve({ success: false, message: `Failed to open shell: ${err.message}` });
        }
      });

      this.client.on("error", (err) => {
        clearTimeout(timeout);
        this.connected = false;
        console.error(`[SSH] Connection error: ${err.message}`);
        resolve({ success: false, message: `Connection failed: ${err.message}` });
      });

      this.client.on("close", () => {
        this.connected = false;
        this.shell = null;
        console.log("[SSH] Connection closed");
      });

      try {
        this.client.connect({
          host: config.host,
          port: config.port,
          username: config.username,
          password: config.password,
          readyTimeout: 30000,
          keepaliveInterval: 10000,
          algorithms: {
            kex: [
              "diffie-hellman-group-exchange-sha256",
              "diffie-hellman-group14-sha256",
              "diffie-hellman-group14-sha1",
              "diffie-hellman-group-exchange-sha1",
              "diffie-hellman-group1-sha1",
            ],
            cipher: [
              "aes128-ctr",
              "aes192-ctr", 
              "aes256-ctr",
              "aes128-cbc",
              "aes192-cbc",
              "aes256-cbc",
              "3des-cbc",
            ],
          },
        });
      } catch (err: any) {
        clearTimeout(timeout);
        resolve({ success: false, message: `Connection failed: ${err.message}` });
      }
    });
  }

  private openShell(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.client) {
        reject(new Error("Not connected"));
        return;
      }

      this.client.shell({ term: "vt100" }, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }

        this.shell = stream;
        this.shellBuffer = "";

        stream.on("data", (data: Buffer) => {
          const text = data.toString();
          this.shellBuffer += text;

          // Handle "More" prompts automatically
          if (this.shellBuffer.includes("---- More") || this.shellBuffer.includes("--More--")) {
            stream.write(" ");
            this.shellBuffer = this.shellBuffer.replace(/---- More.*----/g, "").replace(/--More--/g, "");
          }

          // Check for command completion (prompt returned)
          if (this.currentResolve && (
            this.shellBuffer.match(/[\r\n][^\r\n]*[>#]\s*$/) ||
            this.shellBuffer.includes("end of configuration")
          )) {
            // Give a small delay to collect any remaining output
            if (this.commandTimeout) {
              clearTimeout(this.commandTimeout);
            }
            this.commandTimeout = setTimeout(() => {
              if (this.currentResolve) {
                this.currentResolve(this.shellBuffer);
                this.currentResolve = null;
                this.shellBuffer = "";
                this.isExecuting = false;
                this.processQueue();
              }
            }, 300);
          }
        });

        stream.on("close", () => {
          this.shell = null;
          console.log("[SSH] Shell closed");
        });

        stream.on("error", (err: Error) => {
          console.error("[SSH] Shell error:", err);
        });

        // Wait for initial prompt, then enter enable and config mode
        setTimeout(() => {
          console.log("[SSH] Sending 'enable' command...");
          stream.write("enable\n");
          setTimeout(() => {
            console.log("[SSH] Sending 'config' command...");
            stream.write("config\n");
            setTimeout(() => {
              console.log("[SSH] Shell ready in config mode");
              this.shellBuffer = "";
              resolve();
            }, 1500);
          }, 1500);
        }, 1500);
      });
    });
  }

  disconnect(): void {
    if (this.shell) {
      this.shell.end();
      this.shell = null;
    }
    if (this.client) {
      this.client.end();
      this.client = null;
    }
    this.connected = false;
    this.commandQueue = [];
    this.isExecuting = false;
  }

  isConnected(): boolean {
    return this.connected && this.shell !== null;
  }

  async executeCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.shell || !this.connected) {
        reject(new Error("Not connected to OLT"));
        return;
      }

      // Add to queue
      this.commandQueue.push({ command, resolve, reject });
      this.processQueue();
    });
  }

  private processQueue(): void {
    if (this.isExecuting || this.commandQueue.length === 0 || !this.shell) {
      return;
    }

    const { command, resolve, reject } = this.commandQueue.shift()!;
    this.isExecuting = true;
    this.currentResolve = resolve;
    this.shellBuffer = "";

    // Set timeout for command
    if (this.commandTimeout) {
      clearTimeout(this.commandTimeout);
    }
    this.commandTimeout = setTimeout(() => {
      if (this.currentResolve) {
        console.log(`[SSH] Command timeout: ${command}`);
        this.currentResolve(this.shellBuffer);
        this.currentResolve = null;
        this.isExecuting = false;
        this.processQueue();
      }
    }, 15000);

    // Send command
    console.log(`[SSH] Executing: ${command}`);
    this.shell.write(command + "\n");
  }

  async getOltInfo(): Promise<OltInfo> {
    try {
      const output = await this.executeCommand("display version");
      
      const productMatch = output.match(/MA\d+[A-Z0-9-]+/i);
      const versionMatch = output.match(/V\d+R\d+C\d+/i);
      const patchMatch = output.match(/SPC\d+/i);
      const uptimeMatch = output.match(/uptime is ([^\n]+)/i) || output.match(/Run time:([^\n]+)/i);

      return {
        product: productMatch ? productMatch[0] : "MA5801",
        version: versionMatch ? versionMatch[0] : "Unknown",
        patch: patchMatch ? patchMatch[0] : "-",
        uptime: uptimeMatch ? uptimeMatch[1].trim() : "Unknown",
        connected: true,
      };
    } catch (err) {
      console.error("[SSH] Error getting OLT info:", err);
      return {
        product: "MA5801",
        version: "Unknown",
        patch: "-",
        uptime: "-",
        connected: this.connected,
      };
    }
  }

  async getUnboundOnus(): Promise<UnboundOnu[]> {
    try {
      const output = await this.executeCommand("display ont autofind all");
      return this.parseUnboundOnus(output);
    } catch (err) {
      console.error("[SSH] Error getting unbound ONUs:", err);
      return [];
    }
  }

  private parseUnboundOnus(output: string): UnboundOnu[] {
    const onus: UnboundOnu[] = [];
    const lines = output.split("\n");

    console.log("[SSH] Parsing autofind output, lines:", lines.length);

    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // Look for port indication with SN
      const parts = trimmedLine.split(/\s+/);
      if (parts.length >= 2 && /^\d+\/\d+\/\d+$/.test(parts[0])) {
        const port = parts[0];
        const sn = parts[1];
        
        // Validate SN format (usually 16 hex chars)
        if (sn && /^[A-Fa-f0-9]{16}$/.test(sn)) {
          const equipmentId = parts[2] || "Unknown";
          const softwareVersion = parts[4] || undefined;
          
          onus.push({
            id: sn.toUpperCase(),
            serialNumber: sn.toUpperCase(),
            gponPort: port,
            equipmentId: equipmentId,
            softwareVersion: softwareVersion,
            discoveredAt: new Date().toISOString(),
          });
        }
      }
      
      // Alternative format - look for SN patterns
      const snMatch = trimmedLine.match(/SN\s*[:\s]\s*([A-Fa-f0-9]{16})/i);
      if (snMatch) {
        const sn = snMatch[1].toUpperCase();
        if (!onus.find(o => o.serialNumber === sn)) {
          onus.push({
            id: sn,
            serialNumber: sn,
            gponPort: "0/0/0",
            equipmentId: "Unknown",
            discoveredAt: new Date().toISOString(),
          });
        }
      }
    }

    console.log(`[SSH] Parsed ${onus.length} unbound ONUs`);
    return onus;
  }

  async getBoundOnus(): Promise<BoundOnu[]> {
    try {
      const output = await this.executeCommand("display ont info 0 all");
      const onus = this.parseBoundOnus(output);
      
      // Get optical info for status if we have bound ONUs
      if (onus.length > 0) {
        try {
          const opticalOutput = await this.executeCommand("display ont optical-info 0 all");
          this.enrichWithOpticalInfo(onus, opticalOutput);
        } catch (err) {
          console.log("[SSH] Could not get optical info");
        }
      }
      
      return onus;
    } catch (err) {
      console.error("[SSH] Error getting bound ONUs:", err);
      return [];
    }
  }

  private parseBoundOnus(output: string): BoundOnu[] {
    const onus: BoundOnu[] = [];
    const lines = output.split("\n");

    console.log("[SSH] Parsing bound ONU output, lines:", lines.length);

    for (const line of lines) {
      const trimmedLine = line.trim();
      const parts = trimmedLine.split(/\s+/);
      
      // Look for lines starting with port format
      if (parts.length >= 5 && /^\d+\/\d+\/\d+$/.test(parts[0])) {
        const port = parts[0];
        const onuId = parseInt(parts[1]);
        const sn = parts[2];
        
        // Validate
        if (!isNaN(onuId) && sn && /^[A-Fa-f0-9]{16}$/.test(sn)) {
          const runState = parts[4]?.toLowerCase() || "offline";
          const configState = parts[5]?.toLowerCase() || "normal";
          
          let status: "online" | "offline" | "los" = "offline";
          if (runState.includes("online")) {
            status = "online";
          } else if (runState.includes("los") || runState.includes("dying")) {
            status = "los";
          }

          let configStatus: "normal" | "initial" | "failed" = "normal";
          if (configState.includes("initial")) {
            configStatus = "initial";
          } else if (configState.includes("fail")) {
            configStatus = "failed";
          }

          onus.push({
            id: `${port}-${onuId}`,
            serialNumber: sn.toUpperCase(),
            gponPort: port,
            onuId: onuId,
            status: status,
            configState: configStatus,
            description: "",
            lineProfileId: 1,
            serviceProfileId: 1,
            rxPower: undefined,
            txPower: undefined,
            distance: undefined,
            boundAt: new Date().toISOString(),
          });
        }
      }
    }

    console.log(`[SSH] Parsed ${onus.length} bound ONUs`);
    return onus;
  }

  private enrichWithOpticalInfo(onus: BoundOnu[], output: string): void {
    const lines = output.split("\n");
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      const parts = trimmedLine.split(/\s+/);
      
      if (parts.length >= 4 && /^\d+\/\d+\/\d+$/.test(parts[0])) {
        const port = parts[0];
        const onuId = parseInt(parts[1]);
        const rxPower = parseFloat(parts[2]);
        const txPower = parseFloat(parts[3]);
        
        const onu = onus.find(o => o.gponPort === port && o.onuId === onuId);
        if (onu) {
          onu.rxPower = isNaN(rxPower) ? undefined : rxPower;
          onu.txPower = isNaN(txPower) ? undefined : txPower;
        }
      }
    }
  }

  async getLineProfiles(): Promise<LineProfile[]> {
    try {
      const output = await this.executeCommand("display ont-lineprofile gpon all");
      return this.parseLineProfiles(output);
    } catch (err) {
      console.error("[SSH] Error getting line profiles:", err);
      return [];
    }
  }

  private parseLineProfiles(output: string): LineProfile[] {
    const profiles: LineProfile[] = [];
    const lines = output.split("\n");

    for (const line of lines) {
      const match = line.trim().match(/^(\d+)\s+(\S+)/);
      if (match) {
        const id = parseInt(match[1]);
        const name = match[2];
        
        if (!isNaN(id) && name && !name.includes("Profile") && !name.includes("---")) {
          profiles.push({
            id: id,
            name: name,
            description: name,
            tcont: 1,
            gemportId: 1,
            mappingMode: "vlan",
          });
        }
      }
    }

    console.log(`[SSH] Parsed ${profiles.length} line profiles`);
    return profiles;
  }

  async getServiceProfiles(): Promise<ServiceProfile[]> {
    try {
      const output = await this.executeCommand("display ont-srvprofile gpon all");
      return this.parseServiceProfiles(output);
    } catch (err) {
      console.error("[SSH] Error getting service profiles:", err);
      return [];
    }
  }

  private parseServiceProfiles(output: string): ServiceProfile[] {
    const profiles: ServiceProfile[] = [];
    const lines = output.split("\n");

    for (const line of lines) {
      const match = line.trim().match(/^(\d+)\s+(\S+)/);
      if (match) {
        const id = parseInt(match[1]);
        const name = match[2];
        
        if (!isNaN(id) && name && !name.includes("Profile") && !name.includes("---")) {
          profiles.push({
            id: id,
            name: name,
            description: name,
            portType: "ETH",
            portCount: 1,
          });
        }
      }
    }

    console.log(`[SSH] Parsed ${profiles.length} service profiles`);
    return profiles;
  }

  async getVlans(): Promise<Vlan[]> {
    try {
      const output = await this.executeCommand("display vlan all");
      return this.parseVlans(output);
    } catch (err) {
      console.error("[SSH] Error getting VLANs:", err);
      return [];
    }
  }

  private parseVlans(output: string): Vlan[] {
    const vlans: Vlan[] = [];
    const lines = output.split("\n");

    for (const line of lines) {
      const match = line.trim().match(/^(\d+)\s*(.*)/);
      if (match) {
        const id = parseInt(match[1]);
        const description = match[2]?.trim() || "";
        
        if (!isNaN(id) && id > 0 && id < 4095 && !description.includes("VLAN") && !description.includes("---")) {
          vlans.push({
            id: id,
            name: `VLAN ${id}`,
            description: description || `VLAN ${id}`,
            type: "smart",
            tagged: true,
            inUse: false,
          });
        }
      }
    }

    console.log(`[SSH] Parsed ${vlans.length} VLANs`);
    return vlans;
  }
}

// Singleton instance
export const huaweiSSH = new HuaweiSSH();
