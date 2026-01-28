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
  private lastVlanOutput: string = "";
  
  // Lock for all SSH operations to prevent command interleaving
  private operationLock: Promise<void> | null = null;
  private pendingDataFetch: Promise<{ unbound: UnboundOnu[], bound: BoundOnu[] }> | null = null;

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
            return;
          }

          // Handle <cr>||<K> prompts (Huawei parameter completion prompts) - send Enter once
          // Check if this is a fresh prompt (ends with }:) and we haven't already sent Enter
          if (this.shellBuffer.match(/\{\s*<cr>\|\|<K>\s*\}:\s*$/)) {
            stream.write("\n");
            // Don't return - let it continue to check for completion
          }

          // Check for command completion (prompt returned)
          // Huawei prompts look like: hostname# or hostname(config)# or hostname(config-if-gpon-0/1)#
          // The prompt must be on its own line (not followed by command text or { <cr> prompts)
          if (this.currentResolve) {
            // Wait for a clean prompt line that's not followed by anything else
            // The prompt should be at the very end after command output
            const cleanPromptMatch = this.shellBuffer.match(/[\r\n]([\w\-]+(\([^)]+\))?[#>])\s*$/);
            const hasHuaweiPrompt = this.shellBuffer.includes("<cr>||<K>");
            
            // Only complete if we have a clean prompt AND no pending Huawei prompts at the end
            if ((cleanPromptMatch && !this.shellBuffer.match(/\{\s*<cr>\|\|<K>\s*\}:\s*$/)) || 
                this.shellBuffer.includes("end of configuration")) {
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
              }, 800);
            }
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
        // Use longer delays to ensure each command completes
        const waitForPrompt = (cmd: string, delay: number): Promise<void> => {
          return new Promise((res) => {
            setTimeout(() => {
              console.log(`[SSH] Sending '${cmd}' command...`);
              stream.write(cmd + "\n");
              setTimeout(() => {
                this.shellBuffer = "";
                res();
              }, delay);
            }, 500);
          });
        };

        // Initial delay to wait for login banner
        setTimeout(async () => {
          await waitForPrompt("enable", 2000);
          
          // Fetch VLANs immediately after enable and before config
          try {
            console.log("[SSH] Fetching VLANs in enable mode...");
            const vlanOutput = await this.executeCommand("display vlan all");
            this.lastVlanOutput = vlanOutput; // Store for later fetch
          } catch (vlanErr) {
            console.error("[SSH] Early VLAN fetch failed:", vlanErr);
          }

          await waitForPrompt("config", 2000);
          console.log("[SSH] Shell ready in config mode");
          this.shellBuffer = "";
          this.isExecuting = false;
          resolve();
        }, 2000);
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

  // Get all ONU data in a single interface session to avoid command interleaving
  async getAllOnuData(): Promise<{ unbound: UnboundOnu[], bound: BoundOnu[] }> {
    // If a fetch is already in progress, wait for it
    if (this.pendingDataFetch) {
      console.log("[SSH] Data fetch already in progress, waiting...");
      return this.pendingDataFetch;
    }
    
    // Create new fetch promise
    this.pendingDataFetch = this.doGetAllOnuData();
    
    try {
      const result = await this.pendingDataFetch;
      return result;
    } finally {
      this.pendingDataFetch = null;
    }
  }
  
  private async doGetAllOnuData(): Promise<{ unbound: UnboundOnu[], bound: BoundOnu[] }> {
    try {
      // Enter GPON interface once
      await this.executeCommand("interface gpon 0/1");
      
      // Get autofind (unbound) first
      const autofindOutput = await this.executeCommand("display ont autofind 0");
      const unbound = this.parseUnboundOnus(autofindOutput, "0/1/0");
      
      // Get bound ONUs
      const boundOutput = await this.executeCommand("display ont info 0 all");
      const bound = this.parseBoundOnus(boundOutput, "0/1/0");
      
      // Get optical info for bound ONUs if any (stay in interface mode)
      if (bound.length > 0) {
        try {
          const opticalOutput = await this.executeCommand("display ont optical-info 0 all");
          this.enrichWithOpticalInfo(bound, opticalOutput);
        } catch (err) {
          console.log("[SSH] Could not get optical info:", err);
        }
      }
      
      // Exit interface
      await this.executeCommand("quit");
      
      // Get descriptions (runs in config mode, not interface mode)
      if (bound.length > 0) {
        try {
          const detailOutput = await this.executeCommand("display ont info 0 all detail");
          console.log("[SSH] Raw detail output for descriptions:", detailOutput.substring(0, 500));
          this.parseDescriptions(bound, detailOutput);
        } catch (err) {
          console.log("[SSH] Could not get ONU descriptions:", err);
        }
      }
      
      return { unbound, bound };
    } catch (err) {
      console.error("[SSH] Error getting ONU data:", err);
      return { unbound: [], bound: [] };
    }
  }
  
  private parseDescriptions(onus: BoundOnu[], output: string): void {
    console.log("[SSH] Parsing descriptions, lines:", output.split("\n").length);
    
    let currentPort = "";
    let currentOnuId = -1;
    
    for (const line of output.split("\n")) {
      const trimmedLine = line.trim();
      // Match F/S/P and ONT ID lines (may have spaced format)
      // Example:  -----------------------------------------------------------------------------
      //           F/S/P                : 0/1/0
      const portMatch = trimmedLine.match(/F\s*\/\s*S\s*\/\s*P\s*:\s*(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)/i);
      if (portMatch) {
        currentPort = `${portMatch[1]}/${portMatch[2]}/${portMatch[3]}`;
        continue;
      }
      
      const ontIdMatch = trimmedLine.match(/ONT\s*-?\s*ID\s*:\s*(\d+)/i);
      if (ontIdMatch) {
        currentOnuId = parseInt(ontIdMatch[1]);
        continue;
      }
      
      // Match description line
      const descMatch = trimmedLine.match(/Description\s*:\s*(.+)/i);
      if (descMatch && currentPort && currentOnuId >= 0) {
        const description = descMatch[1].trim();
        // The port in bound_onus table is normalized to 0/1/0 (no spaces)
        const normalizedPort = currentPort.replace(/\s+/g, "");
        const onu = onus.find(o => o.gponPort === normalizedPort && o.onuId === currentOnuId);
        if (onu && description && description !== "-") {
          onu.description = description;
          console.log(`[SSH] Found description: ${normalizedPort}/${currentOnuId} = "${description}"`);
        }
      }
    }
  }

  async getUnboundOnus(): Promise<UnboundOnu[]> {
    try {
      // Enter GPON interface first
      await this.executeCommand("interface gpon 0/1");
      const output = await this.executeCommand("display ont autofind 0");
      // Exit interface
      await this.executeCommand("quit");
      return this.parseUnboundOnus(output, "0/1/0");
    } catch (err) {
      console.error("[SSH] Error getting unbound ONUs:", err);
      return [];
    }
  }

  private parseUnboundOnus(output: string, defaultPort: string = "0/0/0"): UnboundOnu[] {
    const onus: UnboundOnu[] = [];
    const lines = output.split("\n");

    console.log("[SSH] Parsing autofind output, lines:", lines.length);
    console.log("[SSH] Raw autofind output:", output.substring(0, 500));

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
            gponPort: defaultPort,
            equipmentId: "Unknown",
            discoveredAt: new Date().toISOString(),
          });
        }
      }

      // Format: Number  SN  (line with just index and SN)
      // Example: 1      48575443XXXXXXXX
      const indexSnMatch = trimmedLine.match(/^(\d+)\s+([A-Fa-f0-9]{16})/i);
      if (indexSnMatch) {
        const sn = indexSnMatch[2].toUpperCase();
        if (!onus.find(o => o.serialNumber === sn)) {
          onus.push({
            id: sn,
            serialNumber: sn,
            gponPort: defaultPort,
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
      // Enter GPON interface first
      await this.executeCommand("interface gpon 0/1");
      const output = await this.executeCommand("display ont info 0 all");
      const onus = this.parseBoundOnus(output, "0/1/0");
      
      // Get optical info for status if we have bound ONUs
      if (onus.length > 0) {
        try {
          const opticalOutput = await this.executeCommand("display ont optical-info 0 all");
          this.enrichWithOpticalInfo(onus, opticalOutput);
        } catch (err) {
          console.log("[SSH] Could not get optical info");
        }
      }
      
      // Exit interface
      await this.executeCommand("quit");
      return onus;
    } catch (err) {
      console.error("[SSH] Error getting bound ONUs:", err);
      return [];
    }
  }

  private parseBoundOnus(output: string, defaultPort: string = "0/0/0"): BoundOnu[] {
    const onus: BoundOnu[] = [];
    const lines = output.split("\n");

    console.log("[SSH] Parsing bound ONU output, lines:", lines.length);
    console.log("[SSH] Raw bound ONU output:", output.substring(0, 500));

    for (const line of lines) {
      // Match lines like: "0/ 1/0     0 48575443072426B4  active      online   normal   match    no"
      // The port may have spaces like "0/ 1/0" instead of "0/1/0"
      const match = line.match(/^\s*(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)\s+(\d+)\s+([A-Fa-f0-9]{16})\s+(\w+)\s+(\w+)\s+(\w+)\s+(\w+)/);
      
      if (match) {
        const port = `${match[1]}/${match[2]}/${match[3]}`;
        const onuId = parseInt(match[4]);
        const sn = match[5];
        const controlFlag = match[6];
        const runState = match[7]?.toLowerCase() || "offline";
        const configState = match[8]?.toLowerCase() || "normal";
        
        console.log(`[SSH] Found ONU: port=${port}, id=${onuId}, sn=${sn}, run=${runState}, config=${configState}`);
        
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

    console.log(`[SSH] Parsed ${onus.length} bound ONUs`);
    return onus;
  }

  private enrichWithOpticalInfo(onus: BoundOnu[], output: string): void {
    const lines = output.split("\n");
    
    console.log("[SSH] Parsing optical info, lines:", lines.length);
    console.log("[SSH] Raw optical output:", output.substring(0, 800));
    
    // Check if output indicates an error
    if (output.includes("Unknown command") || output.includes("Error:")) {
      console.log("[SSH] Optical info command failed, skipping enrichment");
      return;
    }
    
    let foundCount = 0;
    
    for (const line of lines) {
      // Format 1: ONT-ID only (common in interface mode)
      // Example:    0  -5.47     2.37      -9.57       43           3.300    12       1
      const match1 = line.match(/^\s*(\d+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)/);
      
      if (match1) {
        const onuId = parseInt(match1[1]);
        const rxPower = parseFloat(match1[2]);
        const txPower = parseFloat(match1[3]);
        
        // Find the ONU by ID (assumes we're in a specific port context)
        const onu = onus.find(o => o.onuId === onuId);
        if (onu && !isNaN(rxPower)) {
          onu.rxPower = rxPower;
          onu.txPower = isNaN(txPower) ? undefined : txPower;
          console.log(`[SSH] Enriched ONU ${onuId} with optical: rx=${rxPower}, tx=${txPower}`);
          foundCount++;
        }
        continue;
      }
      
      // Format 2: With F/S/P port format (may have spaces)
      // Example: 0/ 1/0   0      -17.51         2.34           -17.89           1234
      const match2 = line.match(/^\s*(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)\s+(\d+)\s+([\d.-]+)\s+([\d.-]+)/);
      
      if (match2) {
        const port = `${match2[1]}/${match2[2]}/${match2[3]}`;
        const onuId = parseInt(match2[4]);
        const rxPower = parseFloat(match2[5]);
        const txPower = parseFloat(match2[6]);
        
        const onu = onus.find(o => o.gponPort === port && o.onuId === onuId);
        if (onu) {
          onu.rxPower = isNaN(rxPower) ? undefined : rxPower;
          onu.txPower = isNaN(txPower) ? undefined : txPower;
          console.log(`[SSH] Enriched ONU ${port}/${onuId} with optical: rx=${rxPower}, tx=${txPower}`);
          foundCount++;
        }
      }
    }
    
    console.log(`[SSH] Optical enrichment complete: ${foundCount}/${onus.length} ONUs updated`);
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
      // If we have a stored output from the initial connection, use it
      if (this.lastVlanOutput) {
        const output = this.lastVlanOutput;
        this.lastVlanOutput = ""; // Clear after use
        return this.parseVlans(output);
      }

      // Otherwise, we need to quit config mode to run it
      await this.executeCommand("quit");
      const output = await this.executeCommand("display vlan all");
      await this.executeCommand("config");
      return this.parseVlans(output);
    } catch (err) {
      console.error("[SSH] Error getting VLANs:", err);
      return [];
    }
  }

  private parseVlans(output: string): Vlan[] {
    const vlans: Vlan[] = [];
    const lines = output.split("\n");

    // Format: "   1  smart     common              4              0          -"
    // Columns: VLAN, Type, Attribute, STND-Port NUM, SERV-Port NUM, VLAN-Con NUM
    for (const line of lines) {
      // Match line starting with spaces followed by VLAN ID, type, attribute
      const match = line.trim().match(/^(\d+)\s+(smart|standard|mux|super)\s+(\w+)/i);
      if (match) {
        const id = parseInt(match[1]);
        const type = match[2].toLowerCase();
        const attribute = match[3];
        
        if (!isNaN(id) && id > 0 && id < 4095) {
          vlans.push({
            id: id,
            name: `VLAN ${id}`,
            description: `${type} - ${attribute}`,
            type: type,
            tagged: true,
            inUse: false,
          });
          console.log(`[SSH] Found VLAN: ${id} (${type})`);
        }
      }
    }

    console.log(`[SSH] Parsed ${vlans.length} VLANs`);
    return vlans;
  }
}

// Singleton instance
export const huaweiSSH = new HuaweiSSH();
