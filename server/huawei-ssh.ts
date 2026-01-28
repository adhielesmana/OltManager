import { Client } from "ssh2";
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

  async connect(config: HuaweiSSHConfig): Promise<{ success: boolean; message: string }> {
    return new Promise((resolve) => {
      this.config = config;
      this.client = new Client();

      const timeout = setTimeout(() => {
        this.client?.end();
        resolve({ success: false, message: "Connection timeout" });
      }, 30000);

      this.client.on("ready", () => {
        clearTimeout(timeout);
        this.connected = true;
        console.log(`[SSH] Connected to OLT at ${config.host}`);
        resolve({ success: true, message: "Connected to OLT successfully" });
      });

      this.client.on("error", (err) => {
        clearTimeout(timeout);
        this.connected = false;
        console.error(`[SSH] Connection error: ${err.message}`);
        resolve({ success: false, message: `Connection failed: ${err.message}` });
      });

      this.client.on("close", () => {
        this.connected = false;
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

  disconnect(): void {
    if (this.client) {
      this.client.end();
      this.client = null;
    }
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async executeCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.client || !this.connected) {
        reject(new Error("Not connected to OLT"));
        return;
      }

      let output = "";
      let buffer = "";

      this.client.shell((err, stream) => {
        if (err) {
          reject(err);
          return;
        }

        const timeout = setTimeout(() => {
          stream.end();
          resolve(output);
        }, 15000);

        stream.on("data", (data: Buffer) => {
          const text = data.toString();
          buffer += text;
          output += text;

          // Check for command completion indicators
          if (buffer.includes("---- More") || buffer.includes("--More--")) {
            stream.write(" ");
            buffer = "";
          } else if (buffer.includes(">") || buffer.includes("#") || buffer.includes("End of configuration")) {
            if (output.includes(command) && output.length > command.length + 100) {
              clearTimeout(timeout);
              setTimeout(() => {
                stream.end();
                resolve(output);
              }, 500);
            }
          }
        });

        stream.on("close", () => {
          clearTimeout(timeout);
          resolve(output);
        });

        stream.on("error", (err: Error) => {
          clearTimeout(timeout);
          reject(err);
        });

        // Send enable command first, then the actual command
        setTimeout(() => {
          stream.write("enable\n");
          setTimeout(() => {
            stream.write(command + "\n");
          }, 500);
        }, 1000);
      });
    });
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

    // Parse Huawei autofind output format:
    // Frame/Slot/Port  Sn             EquipmentId         VendorId  Version
    // 0/2/0            485754430C9A3F05 HG8310M           HWTC      V3R017C10S120

    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // Look for port indication
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
      
      // Alternative format parsing - look for SN patterns
      const snMatch = trimmedLine.match(/SN\s*:\s*([A-Fa-f0-9]{16})/i);
      if (snMatch) {
        const sn = snMatch[1].toUpperCase();
        // Look for associated port in nearby lines
        const portInfo = output.match(new RegExp(`F/S/P\\s*:\\s*(\\d+/\\d+/\\d+)[\\s\\S]{0,100}${sn}`, 'i')) ||
                        output.match(new RegExp(`${sn}[\\s\\S]{0,100}F/S/P\\s*:\\s*(\\d+/\\d+/\\d+)`, 'i'));
        
        if (!onus.find(o => o.serialNumber === sn)) {
          onus.push({
            id: sn,
            serialNumber: sn,
            gponPort: portInfo ? portInfo[1] : "0/0/0",
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
      // Get all ONT info - this command may vary based on OLT model
      const output = await this.executeCommand("display ont info 0 all");
      const onus = this.parseBoundOnus(output);
      
      // Get optical info for status
      try {
        const opticalOutput = await this.executeCommand("display ont optical-info 0 all");
        this.enrichWithOpticalInfo(onus, opticalOutput);
      } catch (err) {
        console.log("[SSH] Could not get optical info:", err);
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

    // Parse Huawei display ont info format:
    // F/S/P   ONT   SN                  Control    Run      Config   Match    Protect
    //                                   flag       state    state    state    side
    // 0/2/0   1     485754430C9A3F05    active     online   normal   match    no

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
      
      // Parse optical info format
      // F/S/P ONT-ID Rx-Power(dBm) Tx-Power(dBm) OLT-Rx-Power(dBm) Temperature
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

    // Parse profile list
    // Profile-ID  Profile-name
    // 1           FTTH-100M
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

    // Parse VLAN list
    // VLAN-ID  Description
    // 100      Internet
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
