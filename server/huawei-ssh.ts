import { Client, ClientChannel } from "ssh2";
import type { UnboundOnu, BoundOnu, LineProfile, ServiceProfile, Vlan, OltInfo } from "@shared/schema";

export interface HuaweiSSHConfig {
  host: string;
  port: number;
  username: string;
  password: string;
}

// Connection status for UI display
export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "failed";

export class HuaweiSSH {
  private client: Client | null = null;
  private config: HuaweiSSHConfig | null = null;
  private connected: boolean = false;
  private connectionStatus: ConnectionStatus = "disconnected";
  private lastConnectionError: string = "";
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
  private cachedGponPorts: string[] = [];
  
  // Lock for all SSH operations to prevent command interleaving
  private operationLock: Promise<void> | null = null;
  private pendingDataFetch: Promise<{ unbound: UnboundOnu[], bound: BoundOnu[] }> | null = null;
  
  // Global cooldown: 30s wait after any operation completes before another can start
  private lastOperationEndTime: number = 0;
  private readonly OPERATION_COOLDOWN = 30000; // 30 seconds
  
  // Connection retry and lockout protection (prevents Huawei "reenter limit" block)
  private connectionAttempts: number = 0;
  private lastFailedAttempt: number = 0;
  private lockoutUntil: number = 0;
  private readonly MAX_RETRIES = 2; // Max 2 retries after initial attempt
  private readonly RETRY_DELAY = 10000; // 10 seconds between retries
  private readonly LOCKOUT_DURATION = 300000; // 5 minutes lockout after max failures
  
  private async waitForCooldown(operationName: string): Promise<void> {
    // Wait for any pending operations
    if (this.operationLock) {
      console.log(`[SSH] ${operationName}: Waiting for pending operation to complete...`);
      await this.operationLock;
    }
    if (this.pendingDataFetch) {
      console.log(`[SSH] ${operationName}: Waiting for pending data fetch to complete...`);
      await this.pendingDataFetch;
    }
    
    // Check cooldown from last operation
    const now = Date.now();
    const timeSinceLastOp = now - this.lastOperationEndTime;
    if (this.lastOperationEndTime > 0 && timeSinceLastOp < this.OPERATION_COOLDOWN) {
      const waitTime = this.OPERATION_COOLDOWN - timeSinceLastOp;
      console.log(`[SSH] ${operationName}: Cooldown active, waiting ${Math.ceil(waitTime / 1000)}s...`);
      await new Promise(r => setTimeout(r, waitTime));
    }
  }
  
  private markOperationComplete(): void {
    this.lastOperationEndTime = Date.now();
    console.log("[SSH] Operation complete, 30s cooldown started");
  }

  // Check if we're in lockout period
  isLockedOut(): boolean {
    const now = Date.now();
    if (this.lockoutUntil > now) {
      return true;
    }
    return false;
  }
  
  // Get remaining lockout time in seconds
  getLockoutRemaining(): number {
    const now = Date.now();
    if (this.lockoutUntil > now) {
      return Math.ceil((this.lockoutUntil - now) / 1000);
    }
    return 0;
  }
  
  // Reset connection attempts on successful connection
  private resetConnectionAttempts(): void {
    this.connectionAttempts = 0;
    this.lastFailedAttempt = 0;
    this.lockoutUntil = 0;
  }
  
  // Record a failed connection attempt
  private recordFailedAttempt(): void {
    this.connectionAttempts++;
    this.lastFailedAttempt = Date.now();
    
    // If we've exceeded max retries (initial + 2 retries = 3 total), enter lockout
    if (this.connectionAttempts >= this.MAX_RETRIES + 1) {
      this.lockoutUntil = Date.now() + this.LOCKOUT_DURATION;
      console.log(`[SSH] Max connection attempts reached. Lockout for ${this.LOCKOUT_DURATION / 1000}s`);
    }
  }

  // Connect with retry logic and lockout protection
  async connect(config: HuaweiSSHConfig): Promise<{ success: boolean; message: string }> {
    // Check lockout
    if (this.isLockedOut()) {
      const remaining = this.getLockoutRemaining();
      const msg = `Connection blocked: Too many failed attempts. Wait ${remaining}s before retrying.`;
      console.log(`[SSH] ${msg}`);
      this.lastConnectionError = msg;
      return { success: false, message: msg };
    }
    
    this.config = config;
    
    // Try to connect with retries
    for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        console.log(`[SSH] Retry attempt ${attempt}/${this.MAX_RETRIES} after ${this.RETRY_DELAY / 1000}s delay...`);
        await new Promise(r => setTimeout(r, this.RETRY_DELAY));
      }
      
      const result = await this.doConnect(config);
      
      if (result.success) {
        this.resetConnectionAttempts();
        return result;
      }
      
      // Record failed attempt
      this.recordFailedAttempt();
      
      // If we've hit lockout, don't retry
      if (this.isLockedOut()) {
        const remaining = this.getLockoutRemaining();
        return { 
          success: false, 
          message: `Connection failed after ${attempt + 1} attempts. Wait ${remaining}s before retrying. Last error: ${result.message}` 
        };
      }
    }
    
    return { 
      success: false, 
      message: `Connection failed after ${this.MAX_RETRIES + 1} attempts. ${this.lastConnectionError}` 
    };
  }
  
  // Single connection attempt (internal)
  private doConnect(config: HuaweiSSHConfig): Promise<{ success: boolean; message: string }> {
    return new Promise((resolve) => {
      this.client = new Client();
      this.connectionStatus = "connecting";
      this.lastConnectionError = "";
      console.log(`[SSH] Initiating connection to ${config.host}...`);

      const timeout = setTimeout(() => {
        this.client?.end();
        this.connectionStatus = "failed";
        this.lastConnectionError = "Connection timeout";
        resolve({ success: false, message: "Connection timeout" });
      }, 30000);

      this.client.on("ready", async () => {
        clearTimeout(timeout);
        this.connected = true;
        this.connectionStatus = "connected";
        this.lastConnectionError = "";
        console.log(`[SSH] Connected to OLT at ${config.host}`);
        
        // Open persistent shell
        try {
          await this.openShell();
          resolve({ success: true, message: "Connected to OLT successfully" });
        } catch (err: any) {
          this.connectionStatus = "failed";
          this.lastConnectionError = err.message;
          resolve({ success: false, message: `Failed to open shell: ${err.message}` });
        }
      });

      this.client.on("error", (err) => {
        clearTimeout(timeout);
        this.connected = false;
        this.connectionStatus = "failed";
        this.lastConnectionError = err.message;
        console.error(`[SSH] Connection error: ${err.message}`);
        resolve({ success: false, message: `Connection failed: ${err.message}` });
      });

      this.client.on("close", () => {
        this.connected = false;
        this.connectionStatus = "disconnected";
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
          if (this.shellBuffer.match(/\{\s*<cr>\|\|<K>\s*\}:\s*$/)) {
            console.log("[SSH] Handling parameter completion prompt with Enter");
            stream.write("\n");
            // Clear buffer partially to avoid re-triggering immediately
            this.shellBuffer = this.shellBuffer.replace(/\{\s*<cr>\|\|<K>\s*\}:\s*$/, "");
            return;
          }

          // Handle { <cr>|... } prompts (Huawei multi-option prompts)
          // These prompts look like: { <cr>|vlanattr<K>|vlantype<E><mux,standard,smart,super>||<K> }: 
          // We need to match the structure and the trailing }: 
          if (this.shellBuffer.match(/\{\s*<cr>[\s\S]*?\}\s*:\s*$/)) {
            console.log("[SSH] Handling multi-option prompt with Enter");
            if (this.shell) {
              this.shell.write("\n");
            }
            // Clear the specific prompt from buffer to avoid loops
            this.shellBuffer = this.shellBuffer.replace(/\{\s*<cr>[\s\S]*?\}\s*:\s*$/, "");
            return;
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
          
          // Disable pagination for the session - best for automation
          console.log("[SSH] Disabling screen-length pagination...");
          await waitForPrompt("screen-length 0 temporary", 1000);
          
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

  // Clean disconnect with proper Huawei logout sequence
  async disconnect(): Promise<void> {
    console.log("[SSH] Starting clean disconnect...");
    
    // Try clean logout if shell is active
    if (this.shell && this.connected) {
      try {
        // Send quit commands to exit cleanly from any config mode
        // This prevents Huawei from counting as "unclean exit"
        console.log("[SSH] Sending clean logout sequence...");
        
        // Exit any nested modes first
        this.shell.write("quit\n");
        await new Promise(r => setTimeout(r, 500));
        
        // Exit to user mode
        this.shell.write("quit\n");
        await new Promise(r => setTimeout(r, 500));
        
        // Final quit or logout (may ask for confirmation)
        this.shell.write("quit\n");
        await new Promise(r => setTimeout(r, 300));
        
        // Handle "Save configuration? [y/n]" prompt if it appears
        this.shell.write("n\n");
        await new Promise(r => setTimeout(r, 300));
        
        console.log("[SSH] Clean logout sequence completed");
      } catch (err) {
        console.log("[SSH] Error during clean logout:", err);
      }
    }
    
    // Close shell
    if (this.shell) {
      try {
        this.shell.end();
      } catch (e) {
        // Ignore errors during shell close
      }
      this.shell = null;
    }
    
    // Close client connection
    if (this.client) {
      try {
        this.client.end();
      } catch (e) {
        // Ignore errors during client close
      }
      this.client = null;
    }
    
    this.connected = false;
    this.connectionStatus = "disconnected";
    this.commandQueue = [];
    this.isExecuting = false;
    this.cachedGponPorts = []; // Clear cached ports on disconnect
    console.log("[SSH] Disconnected from OLT");
  }

  isConnected(): boolean {
    return this.connected && this.shell !== null;
  }

  // Get connection status for UI display
  getConnectionStatus(): ConnectionStatus {
    return this.connectionStatus;
  }

  // Get last connection error message
  getLastError(): string {
    return this.lastConnectionError;
  }

  // Check if connection is in progress (connecting)
  isConnecting(): boolean {
    return this.connectionStatus === "connecting";
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

  // Helper to add delay between heavy commands to ensure shell buffer is ready
  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Execute command with pre-delay to ensure shell buffer is clear
  async executeCommandWithDelay(command: string, delayMs: number = 500): Promise<string> {
    await this.delay(delayMs);
    return this.executeCommand(command);
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

    // Send command (screen-length is set once at session start)
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
      
      // Get sysname/hostname from command output or prompt
      let hostname = "";
      let serialNumber = "";
      
      // First try to extract from command output prompt (e.g., "ISP-PWS-LKTPJG-P-01-HWI>")
      const promptMatch = output.match(/\n([A-Za-z0-9_-]+)(?:\([^)]*\))?[#>]\s*$/m) ||
                         output.match(/([A-Za-z0-9_-]+)(?:\([^)]*\))?[#>]/);
      if (promptMatch && promptMatch[1]) {
        hostname = promptMatch[1];
      }
      
      // Try sysname command as fallback
      if (!hostname) {
        try {
          const sysnameOutput = await this.executeCommand("display sysname");
          const sysnameMatch = sysnameOutput.match(/sysname\s+(.+)/i) || 
                              sysnameOutput.match(/System Name:\s*(.+)/i) ||
                              sysnameOutput.match(/\n\s*([A-Za-z0-9_-]+)\s*$/m);
          if (sysnameMatch) {
            hostname = sysnameMatch[1].trim();
          }
        } catch (e) {
          // Hostname extraction from prompt already attempted
        }
      }
      
      // Try to get device serial number from elabel
      try {
        const esOutput = await this.executeCommand("display elabel 0");
        const snMatch = esOutput.match(/Bar\s*Code\s*:\s*([A-Z0-9]+)/i) || 
                       esOutput.match(/Serial\s*Number\s*:\s*([A-Z0-9]+)/i);
        if (snMatch) {
          serialNumber = snMatch[1].trim();
        }
      } catch (e) {
        // Serial number is optional
      }

      return {
        product: productMatch ? productMatch[0] : "MA5801",
        version: versionMatch ? versionMatch[0] : "Unknown",
        patch: patchMatch ? patchMatch[0] : "-",
        uptime: uptimeMatch ? uptimeMatch[1].trim() : "Unknown",
        connected: true,
        hostname: hostname || undefined,
        model: productMatch ? productMatch[0] : undefined,
        serialNumber: serialNumber || undefined,
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
    
    // Wait for cooldown from any previous operation
    await this.waitForCooldown("AutoSync");
    
    // Create new fetch promise
    this.pendingDataFetch = this.doGetAllOnuData();
    
    try {
      const result = await this.pendingDataFetch;
      return result;
    } finally {
      this.pendingDataFetch = null;
      this.markOperationComplete();
    }
  }
  
  private async doGetAllOnuData(): Promise<{ unbound: UnboundOnu[], bound: BoundOnu[] }> {
    try {
      const allUnbound: UnboundOnu[] = [];
      const allBound: BoundOnu[] = [];
      
      // Detect which slots have GPON boards
      const gponSlots = await this.detectGponSlots();
      console.log(`[SSH] Detected GPON slots: ${gponSlots.join(", ")}`);
      
      // Scan each GPON slot
      for (const slot of gponSlots) {
        try {
          // Enter GPON interface for this slot
          await this.executeCommand(`interface gpon 0/${slot}`);
          
          // Get autofind (unbound) for ALL ports on this slot
          const autofindOutput = await this.executeCommand("display ont autofind all");
          const unbound = this.parseUnboundOnus(autofindOutput, `0/${slot}/0`);
          allUnbound.push(...unbound);
          console.log(`[SSH] Found ${unbound.length} unbound ONUs on slot ${slot}`);
          
          // Get bound ONUs for ALL ports on this slot
          const boundOutput = await this.executeCommand("display ont info all all");
          const bound = this.parseBoundOnus(boundOutput, `0/${slot}/0`);
          allBound.push(...bound);
          console.log(`[SSH] Found ${bound.length} bound ONUs on slot ${slot}`);
          
          // Get optical info for bound ONUs if any (stay in interface mode)
          if (bound.length > 0) {
            try {
              // Add delay to ensure shell buffer is clear after heavy display ont info command
              const opticalOutput = await this.executeCommandWithDelay("display ont optical-info all all", 800);
              this.enrichWithOpticalInfo(bound, opticalOutput);
            } catch (err) {
              console.log("[SSH] Could not get optical info:", err);
            }
          }
          
          // Get descriptions for each ONU (inside interface mode)
          if (bound.length > 0) {
            for (const onu of bound) {
              try {
                // Extract port number from gponPort (e.g., "0/1/5" -> 5)
                const portMatch = onu.gponPort.match(/\d+\/\d+\/(\d+)/);
                const portNum = portMatch ? portMatch[1] : "0";
                const detailOutput = await this.executeCommand(`display ont info ${portNum} ${onu.onuId}`);
                console.log(`[SSH] Detail for ONU ${onu.onuId}:`, detailOutput.substring(0, 500));
                this.parseOnuDescription(onu, detailOutput);
              } catch (err) {
                console.log(`[SSH] Could not get description for ONU ${onu.onuId}:`, err);
              }
            }
          }
          
          // Exit interface
          await this.executeCommand("quit");
        } catch (err) {
          console.error(`[SSH] Error scanning slot ${slot}:`, err);
          // Try to exit interface mode if we're stuck
          try { await this.executeCommand("quit"); } catch {}
        }
      }
      
      return { unbound: allUnbound, bound: allBound };
    } catch (err) {
      console.error("[SSH] Error getting ONU data:", err);
      return { unbound: [], bound: [] };
    }
  }
  
  // Detect which slots have GPON boards
  private async detectGponSlots(): Promise<number[]> {
    try {
      const output = await this.executeCommand("display board 0");
      const slots: number[] = [];
      
      const lines = output.split('\n');
      for (const line of lines) {
        // Match lines with slot and board name containing "GP": "  1       V922GPHF   Normal"
        const match = line.match(/^\s*(\d+)\s+(\S+)\s+\S+/);
        if (match) {
          const slot = parseInt(match[1]);
          const boardName = match[2].toUpperCase();
          
          // Check if it's a GPON board (must contain GP)
          if (boardName.includes('GP')) {
            slots.push(slot);
            console.log(`[SSH] Found GPON board on slot ${slot}: ${boardName}`);
          }
        }
      }
      
      // If no GPON boards detected, default to slot 1
      if (slots.length === 0) {
        console.log("[SSH] No GPON boards detected, defaulting to slot 1");
        return [1];
      }
      
      return slots;
    } catch (err) {
      console.error("[SSH] Error detecting GPON slots:", err);
      return [1]; // Default to slot 1
    }
  }
  
  private parseOnuDescription(onu: BoundOnu, output: string): void {
    for (const line of output.split("\n")) {
      const trimmedLine = line.trim();
      // Match description line: Description  : some text
      const descMatch = trimmedLine.match(/Description\s*:\s*(.+)/i);
      if (descMatch) {
        const description = descMatch[1].trim();
        if (description && description !== "-") {
          onu.description = description;
          console.log(`[SSH] Found description for ONU ${onu.onuId}: "${description}"`);
        }
        break;
      }
    }
  }

  async getUnboundOnus(): Promise<UnboundOnu[]> {
    try {
      const allUnbound: UnboundOnu[] = [];
      
      // Detect which slots have GPON boards
      const gponSlots = await this.detectGponSlots();
      console.log(`[SSH] Getting unbound ONUs from slots: ${gponSlots.join(", ")}`);
      
      // Scan each GPON slot
      for (const slot of gponSlots) {
        try {
          // Enter GPON interface for this slot
          await this.executeCommand(`interface gpon 0/${slot}`);
          
          // Get autofind (unbound) for ALL ports on this slot
          const output = await this.executeCommand("display ont autofind all");
          const unbound = this.parseUnboundOnus(output, `0/${slot}/0`);
          allUnbound.push(...unbound);
          console.log(`[SSH] Found ${unbound.length} unbound ONUs on slot ${slot}`);
          
          // Exit interface
          await this.executeCommand("quit");
        } catch (err) {
          console.error(`[SSH] Error scanning slot ${slot}:`, err);
          try { await this.executeCommand("quit"); } catch {}
        }
      }
      
      return allUnbound;
    } catch (err) {
      console.error("[SSH] Error getting unbound ONUs:", err);
      return [];
    }
  }

  private parseUnboundOnus(output: string, defaultPort: string = "0/0/0"): UnboundOnu[] {
    const onus: UnboundOnu[] = [];
    const lines = output.split("\n");
    
    // Track current port from section headers (e.g., "Port: 0/1/15" or "F/S/P: 0/1/15")
    let currentPort = defaultPort;

    console.log("[SSH] Parsing autofind output, lines:", lines.length);
    console.log("[SSH] Raw autofind output:", output.substring(0, 1000));

    for (const line of lines) {
      const trimmedLine = line.trim();
      const parts = trimmedLine.split(/\s+/);
      
      // Check for section header with port (updates currentPort for subsequent lines)
      // Example: "Port: 0/1/15" or "F/S/P: 0/1/15" or "Port  0/1/15"
      const portHeaderMatch = trimmedLine.match(/(?:Port|F\/S\/P)\s*[:\s]\s*(\d+)\/\s*(\d+)\/(\d+)/i);
      if (portHeaderMatch) {
        currentPort = `${portHeaderMatch[1]}/${portHeaderMatch[2]}/${portHeaderMatch[3]}`;
        console.log(`[SSH] Section port header found: ${currentPort}`);
        continue;
      }
      
      // Format 1: Port as first column
      // Example: 0/1/15  48575443XXXXXXXX  HG8310M  ...
      if (parts.length >= 2 && /^\d+\/\d+\/\d+$/.test(parts[0])) {
        const port = parts[0];
        const sn = parts[1];
        
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
          console.log(`[SSH] Parsed unbound ONU: SN=${sn}, Port=${port}`);
          continue;
        }
      }
      
      // Format 2: Number  F/S/P  SN  ... (port in second column)
      // Example: 1  0/1/15  48575443XXXXXXXX  HG8310M  ...
      if (parts.length >= 3 && /^\d+$/.test(parts[0]) && /^\d+\/\d+\/\d+$/.test(parts[1])) {
        const port = parts[1];
        const sn = parts[2];
        
        if (sn && /^[A-Fa-f0-9]{16}$/.test(sn)) {
          const equipmentId = parts[3] || "Unknown";
          const softwareVersion = parts[5] || undefined;
          
          if (!onus.find(o => o.serialNumber === sn.toUpperCase())) {
            onus.push({
              id: sn.toUpperCase(),
              serialNumber: sn.toUpperCase(),
              gponPort: port,
              equipmentId: equipmentId,
              softwareVersion: softwareVersion,
              discoveredAt: new Date().toISOString(),
            });
            console.log(`[SSH] Parsed unbound ONU (format 2): SN=${sn}, Port=${port}`);
          }
          continue;
        }
      }
      
      // Format 3: Number  0/ 1/15  SN  ... (port with spaces - Huawei quirk)
      // Example: 1  0/ 1/15  48575443XXXXXXXX  HG8310M  ...
      const spacedPortMatch = trimmedLine.match(/^\s*(\d+)\s+(\d+)\/\s*(\d+)\/(\d+)\s+([A-Fa-f0-9]{16})\s+(\S+)?/i);
      if (spacedPortMatch) {
        const port = `${spacedPortMatch[2]}/${spacedPortMatch[3]}/${spacedPortMatch[4]}`;
        const sn = spacedPortMatch[5].toUpperCase();
        const equipmentId = spacedPortMatch[6] || "Unknown";
        
        if (!onus.find(o => o.serialNumber === sn)) {
          onus.push({
            id: sn,
            serialNumber: sn,
            gponPort: port,
            equipmentId: equipmentId,
            discoveredAt: new Date().toISOString(),
          });
          console.log(`[SSH] Parsed unbound ONU (spaced port): SN=${sn}, Port=${port}`);
        }
        continue;
      }
      
      // Format 4: Just SN with port context from section header
      // Look for SN patterns in line
      const snMatch = trimmedLine.match(/SN\s*[:\s]\s*([A-Fa-f0-9]{16})/i);
      if (snMatch) {
        const sn = snMatch[1].toUpperCase();
        if (!onus.find(o => o.serialNumber === sn)) {
          onus.push({
            id: sn,
            serialNumber: sn,
            gponPort: currentPort,
            equipmentId: "Unknown",
            discoveredAt: new Date().toISOString(),
          });
          console.log(`[SSH] Parsed unbound ONU (SN pattern): SN=${sn}, Port=${currentPort}`);
        }
        continue;
      }

      // Format 5: Number  SN  (line with just index and SN, no port in line)
      // Example: 1      48575443XXXXXXXX
      // This happens when the port is shown in a header section
      const indexSnMatch = trimmedLine.match(/^(\d+)\s+([A-Fa-f0-9]{16})$/i);
      if (indexSnMatch) {
        const sn = indexSnMatch[2].toUpperCase();
        if (!onus.find(o => o.serialNumber === sn)) {
          onus.push({
            id: sn,
            serialNumber: sn,
            gponPort: currentPort,
            equipmentId: "Unknown",
            discoveredAt: new Date().toISOString(),
          });
          console.log(`[SSH] Parsed unbound ONU (index+SN): SN=${sn}, Port=${currentPort}`);
        }
      }
    }

    console.log(`[SSH] Parsed ${onus.length} unbound ONUs total`);
    return onus;
  }

  async getBoundOnus(): Promise<BoundOnu[]> {
    let onus: BoundOnu[] = [];
    try {
      // Enter GPON interface first
      await this.executeCommand("interface gpon 0/1");
      const output = await this.executeCommand("display ont info 0 all");
      onus = this.parseBoundOnus(output, "0/1/0");
      
      // Get optical info for status if we have bound ONUs
      if (onus.length > 0) {
        try {
          // Add delay to ensure shell buffer is clear after heavy display ont info command
          const opticalOutput = await this.executeCommandWithDelay("display ont optical-info 0 all", 800);
          this.enrichWithOpticalInfo(onus, opticalOutput);
        } catch (err) {
          console.log("[SSH] Could not get optical info");
        }
        
        // Get descriptions for each ONU
        for (const onu of onus) {
          try {
            const detailOutput = await this.executeCommand(`display ont info 0 ${onu.onuId}`);
            this.parseOnuDescription(onu, detailOutput);
          } catch (err) {
            console.log(`[SSH] Could not get description for ONU ${onu.onuId}`);
          }
        }
      }
      
      return onus;
    } catch (err) {
      console.error("[SSH] Error getting bound ONUs:", err);
      return [];
    } finally {
      // Always exit interface back to config mode
      try {
        await this.executeCommand("quit");
      } catch (e) {
        console.log("[SSH] Error during quit:", e);
      }
    }
  }

  // Get list of used ONU IDs on a specific GPON port directly from the OLT
  async getUsedOnuIds(gponPort: string): Promise<number[]> {
    const usedIds: number[] = [];
    try {
      // Parse port - format is "0/1/0" -> frame=0, slot=1, port=0
      const portParts = gponPort.split("/");
      if (portParts.length !== 3) {
        console.log(`[SSH] Invalid port format for getUsedOnuIds: ${gponPort}`);
        return [];
      }
      const [frame, slot, port] = portParts.map(p => parseInt(p));

      // Enter GPON interface
      await this.executeCommand(`interface gpon ${frame}/${slot}`);
      
      // Get bound ONUs on this port
      const output = await this.executeCommand(`display ont info ${port} all`);
      console.log(`[SSH] Checking used ONU IDs on port ${gponPort}:`, output.substring(0, 300));
      
      // Parse for ONU IDs - format: "0     0 48575443072426B4  active ..."
      // We're looking for lines where the first column is the port (matching our port) and second is ONU ID
      for (const line of output.split("\n")) {
        // Match ONU ID from lines like: "    0 48575443072426B4  active      online"
        // When inside interface gpon X/Y, the "display ont info P all" shows just Port and ONU-ID
        const match = line.match(/^\s*(\d+)\s+([A-Fa-f0-9]{16})\s+/);
        if (match) {
          const onuId = parseInt(match[1]);
          usedIds.push(onuId);
          console.log(`[SSH] Found used ONU ID ${onuId} on port ${gponPort}`);
        }
      }
      
      // Exit interface
      await this.executeCommand("quit");
      
      console.log(`[SSH] Total used ONU IDs on port ${gponPort}: [${usedIds.join(", ")}]`);
      return usedIds;
    } catch (err) {
      console.error(`[SSH] Error getting used ONU IDs for port ${gponPort}:`, err);
      try {
        await this.executeCommand("quit");
      } catch (e) {}
      return usedIds;
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

  async getGponPorts(): Promise<string[]> {
    // Return cached ports if available
    if (this.cachedGponPorts.length > 0) {
      return this.cachedGponPorts;
    }
    
    if (!this.isConnected()) {
      console.log("[SSH] Not connected, cannot get GPON ports");
      return [];
    }

    // Wait for shell to be ready (not executing)
    let retries = 0;
    while (this.isExecuting && retries < 10) {
      await new Promise(r => setTimeout(r, 500));
      retries++;
    }
    
    if (this.isExecuting) {
      console.log("[SSH] Shell busy, cannot get GPON ports now");
      return [];
    }

    try {
      const ports: string[] = [];
      
      // Method 1: Try display port state for each possible slot
      for (const slot of [1, 2]) {
        try {
          const output = await this.executeCommand(`display port state 0/${slot}`);
          console.log(`[SSH] Port state 0/${slot} output:\n${output.substring(0, 500)}`);
          
          // Check if command succeeded (no error message)
          if (output.includes("Unknown command") || output.includes("Failure") || output.includes("Error")) {
            continue;
          }
          
          // Parse for port entries - looking for port numbers in a table format
          const lines = output.split('\n');
          for (const line of lines) {
            // Match lines like "0    up    up" or "15   down  down" 
            const portMatch = line.match(/^\s*(\d+)\s+(up|down)/i);
            if (portMatch) {
              const portNum = parseInt(portMatch[1]);
              ports.push(`0/${slot}/${portNum}`);
            }
          }
          
          if (ports.length > 0) {
            console.log(`[SSH] Found ${ports.length} ports on slot ${slot}`);
          }
        } catch (err) {
          console.log(`[SSH] Port state query for slot ${slot} failed:`, err);
        }
      }
      
      // Method 2: If no ports found, try board info and detect by board name
      if (ports.length === 0) {
        try {
          const output = await this.executeCommand("display board 0");
          console.log(`[SSH] Board info output:\n${output.substring(0, 1000)}`);
          
          // Known Huawei GPON board types and their port counts
          const boardPortCounts: Record<string, number> = {
            // 8-port boards
            'H802GPBD': 8, 'H802GPFA': 8, 'H801GPBD': 8, 'H801GPFA': 8,
            'V802GPBD': 8, 'V802GPFA': 8, 'V801GPBD': 8, 'V801GPFA': 8,
            // 16-port boards
            'H802GPFD': 16, 'H802GPHF': 16, 'H801GPFD': 16, 'H801GPHF': 16,
            'V802GPFD': 16, 'V802GPHF': 16, 'V922GPHF': 16, 'V921GPHF': 16,
            'H805GPFD': 16, 'H806GPHF': 16,
          };
          
          const lines = output.split('\n');
          for (const line of lines) {
            // Match lines with slot and board name: "  1       V922GPHF   Normal"
            const match = line.match(/^\s*(\d+)\s+(\S+)\s+\S+/);
            if (match) {
              const slot = parseInt(match[1]);
              const boardName = match[2].toUpperCase();
              
              // Skip if not a GPON board (must contain GP)
              if (!boardName.includes('GP')) {
                continue;
              }
              
              // Look up exact board name first
              let portCount = boardPortCounts[boardName];
              
              // If not found, check for partial matches
              if (!portCount) {
                for (const [boardType, count] of Object.entries(boardPortCounts)) {
                  if (boardName.includes(boardType)) {
                    portCount = count;
                    break;
                  }
                }
              }
              
              // Default to 16 ports for unknown GP boards
              if (!portCount) {
                portCount = 16;
              }
              
              console.log(`[SSH] Found GPON board ${boardName} on slot ${slot} with ${portCount} ports`);
              for (let p = 0; p < portCount; p++) {
                ports.push(`0/${slot}/${p}`);
              }
            }
          }
        } catch (err) {
          console.log("[SSH] Board info query failed:", err);
        }
      }
      
      // Cache the results
      if (ports.length > 0) {
        // Sort ports naturally (0/1/0, 0/1/1, ... 0/1/15, 0/2/0, ...)
        this.cachedGponPorts = ports.sort((a, b) => {
          const aParts = a.split('/').map(Number);
          const bParts = b.split('/').map(Number);
          for (let i = 0; i < 3; i++) {
            if (aParts[i] !== bParts[i]) return aParts[i] - bParts[i];
          }
          return 0;
        });
        console.log(`[SSH] Cached ${this.cachedGponPorts.length} GPON ports: ${this.cachedGponPorts.join(', ')}`);
      }
      
      return this.cachedGponPorts;
    } catch (error) {
      console.error("[SSH] Error getting GPON ports:", error);
      return [];
    }
  }
  
  // Clear cached ports (called on disconnect or reconnect)
  clearCachedPorts(): void {
    this.cachedGponPorts = [];
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
            type: type as "smart" | "mux" | "standard",
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

  async getOnuOpticalInfo(gponPort: string, onuId: number): Promise<{ rxPower?: number; txPower?: number; distance?: number } | null> {
    if (!this.isConnected()) {
      return null;
    }

    try {
      const portParts = gponPort.split("/");
      if (portParts.length !== 3) {
        return null;
      }
      const [frame, slot, port] = portParts.map(p => parseInt(p));

      // Enter interface gpon
      await this.executeCommand("interface gpon " + String(frame) + "/" + String(slot));
      
      // Get optical info for this specific ONU
      const opticalCmd = "display ont optical-info " + String(port) + " " + String(onuId);
      const output = await this.executeCommand(opticalCmd);
      
      console.log(`[SSH] Optical info raw output:\n${output}`);
      
      await this.executeCommand("quit");

      // Parse output for RX/TX power
      // Format: ONU NNI upstream optical power(dBm)  : -X.XX
      //         Laser bias current(mA)               : X.XX
      //         Temperature(C)                       : XX
      //         Voltage(V)                           : X.XX
      //         ONU NNI downstream optical power(dBm): -X.XX
      
      let rxPower: number | undefined;
      let txPower: number | undefined;
      let distance: number | undefined;

      const lines = output.split('\n');
      for (const line of lines) {
        // RX power (downstream)
        if (line.includes("downstream optical power") || line.includes("Rx optical power")) {
          const match = line.match(/([-\d.]+)\s*$/);
          if (match) {
            rxPower = parseFloat(match[1]);
          }
        }
        // TX power (upstream)  
        if (line.includes("upstream optical power") || line.includes("OLT Rx ONT optical power")) {
          const match = line.match(/([-\d.]+)\s*$/);
          if (match) {
            txPower = parseFloat(match[1]);
          }
        }
        // Distance
        if (line.includes("ONU Distance") || line.includes("distance")) {
          const match = line.match(/(\d+)/);
          if (match) {
            distance = parseInt(match[1]);
          }
        }
      }

      console.log(`[SSH] Optical info for ${gponPort} ONU ${onuId}: rx=${rxPower}, tx=${txPower}, distance=${distance}`);
      return { rxPower, txPower, distance };
    } catch (error) {
      console.error("[SSH] Error getting optical info:", error);
      return null;
    }
  }

  async bindOnu(params: {
    serialNumber: string;
    gponPort: string;
    onuId: number;
    lineProfileName: string;
    serviceProfileName: string;
    description: string;
    vlanId: number;
    gemportId: number;
    pppoeUsername?: string;
    pppoePassword?: string;
    onuType?: "huawei" | "general";
  }): Promise<{ success: boolean; message: string }> {
    if (!this.isConnected()) {
      return { success: false, message: "Not connected to OLT" };
    }

    // Wait for cooldown from any previous operation
    await this.waitForCooldown("Bind");

    // Create operation lock
    let releaseLock: () => void;
    this.operationLock = new Promise<void>(resolve => { releaseLock = resolve; });

    try {
      const { serialNumber, gponPort, onuId, lineProfileName, serviceProfileName, description, vlanId, gemportId, pppoeUsername, pppoePassword, onuType = "huawei" } = params;
      
      // Parse port - format is "0/1/0" -> frame=0, slot=1, port=0
      const portParts = gponPort.split("/");
      if (portParts.length !== 3) {
        return { success: false, message: `Invalid port format: ${gponPort}` };
      }
      const [frame, slot, port] = portParts.map(p => parseInt(p));

      const isGeneral = onuType === "general";
      console.log(`[SSH] Binding ${isGeneral ? "General" : "Huawei"} ONU ${serialNumber} to port ${gponPort} as ONU ID ${onuId}`);
      console.log(`[SSH] Profiles: line=${lineProfileName}, service=${serviceProfileName}, vlan=${vlanId}`);

      // Step 1: Enter config mode
      console.log(`[SSH] Step 1: Entering config mode...`);
      await this.executeCommand("quit");
      await this.executeCommand("config");

      // Step 2: Enter GPON interface
      console.log(`[SSH] Step 2: Entering interface gpon ${frame}/${slot}...`);
      await this.executeCommand("interface gpon " + String(frame) + "/" + String(slot));

      // Slot/Port format for commands: "PORT ONU_ID" e.g. "0 0"
      const slotPort = String(port) + " " + String(onuId);

      // Step 3: Add the ONT
      // Huawei ONU: uses "omci" for OMCI management binding
      // General ONU: no "omci" - ONU is registered but config done manually via ONU web interface
      let addCmd: string;
      if (isGeneral) {
        // General ONU - register without OMCI binding (manual configuration via ONU web interface)
        addCmd = "ont add " + slotPort + 
          " sn-auth " + serialNumber + 
          " ont-lineprofile-name " + lineProfileName + 
          " ont-srvprofile-name " + serviceProfileName + 
          " desc " + description.replace(/\s+/g, "_").substring(0, 32);
        console.log(`[SSH] Step 3: Adding General ONU (no OMCI) with: ${addCmd}`);
      } else {
        // Huawei ONU - standard OMCI binding
        addCmd = "ont add " + slotPort + 
          " sn-auth " + serialNumber + 
          " omci ont-lineprofile-name " + lineProfileName + 
          " ont-srvprofile-name " + serviceProfileName + 
          " desc " + description.replace(/\s+/g, "_").substring(0, 32);
        console.log(`[SSH] Step 3: Adding Huawei ONU (with OMCI) with: ${addCmd}`);
      }
      
      const addResult = await this.executeCommand(addCmd);
      console.log(`[SSH] Add result: ${addResult}`);

      if (addResult.includes("Failure") || addResult.includes("Error") || addResult.includes("Unknown command")) {
        await this.executeCommand("quit");
        return { success: false, message: `Failed to add ONU: ${addResult.substring(0, 200)}` };
      }

      // Step 4-8: Configure PPPoE if username and password provided
      if (pppoeUsername && pppoePassword) {
        console.log(`[SSH] Step 4: Configuring PPPoE for user ${pppoeUsername}...`);
        
        // ont ipconfig [Slot/Port] pppoe vlan [VLAN] priority 5 user-account username [USER] password [PASS]
        const pppoeCmd = "ont ipconfig " + slotPort + 
          " pppoe vlan " + String(vlanId) + 
          " priority 5 user-account username " + pppoeUsername + 
          " password " + pppoePassword;
        
        console.log(`[SSH] Executing: ont ipconfig ${slotPort} pppoe vlan ${vlanId} priority 5 user-account username ${pppoeUsername} password ****`);
        const pppoeResult = await this.executeCommand(pppoeCmd);
        console.log(`[SSH] PPPoE result: ${pppoeResult}`);

        // Step 5: ont internet-config [Slot/Port] ip-index 0
        console.log(`[SSH] Step 5: Configuring internet...`);
        const internetCmd = "ont internet-config " + slotPort + " ip-index 0";
        const internetResult = await this.executeCommand(internetCmd);
        console.log(`[SSH] Internet config result: ${internetResult.substring(0, 100)}`);

        // Step 6: ont wan-config [Slot/Port] ip-index 0 profile-name pppoe_wan
        console.log(`[SSH] Step 6: Configuring WAN...`);
        const wanCmd = "ont wan-config " + slotPort + " ip-index 0 profile-name pppoe_wan";
        const wanResult = await this.executeCommand(wanCmd);
        console.log(`[SSH] WAN config result: ${wanResult.substring(0, 100)}`);

        // Step 7: ont policy-route-config [Slot/Port] profile-name pppoe_policy
        console.log(`[SSH] Step 7: Configuring policy route...`);
        const policyCmd = "ont policy-route-config " + slotPort + " profile-name pppoe_policy";
        const policyResult = await this.executeCommand(policyCmd);
        console.log(`[SSH] Policy route result: ${policyResult.substring(0, 100)}`);

        // Step 8: ont port route [Slot/Port] eth 1-4 enable
        console.log(`[SSH] Step 8: Enabling port routing...`);
        const portRouteCmd = "ont port route " + slotPort + " eth 1-4 enable";
        const portRouteResult = await this.executeCommand(portRouteCmd);
        console.log(`[SSH] Port route result: ${portRouteResult.substring(0, 100)}`);
      }

      // Exit GPON interface first
      await this.executeCommand("quit");

      // Step 9: Create service-port to map VLAN (CRITICAL for VLAN passthrough)
      // This is required for both PPPoE and bridge mode
      // Format: service-port vlan [VLAN] gpon [F/S/P] ont [ONU_ID] gemport [GEMPORT] multi-service user-vlan [VLAN] tag-transform translate
      console.log(`[SSH] Step 9: Creating service-port for VLAN ${vlanId} with gemport ${gemportId}...`);
      const servicePortCmd = "service-port vlan " + String(vlanId) + 
        " gpon " + gponPort + 
        " ont " + String(onuId) + 
        " gemport " + String(gemportId) + " multi-service user-vlan " + String(vlanId) + 
        " tag-transform translate";
      console.log(`[SSH] Service-port command: ${servicePortCmd}`);
      const servicePortResult = await this.executeCommand(servicePortCmd);
      console.log(`[SSH] Service-port full result:\n${servicePortResult}`);

      if (servicePortResult.includes("Failure") || servicePortResult.includes("Error") || servicePortResult.includes("error")) {
        console.error(`[SSH] ERROR: Service-port creation failed: ${servicePortResult}`);
        // Don't return failure - the ONU is already bound, just log warning
      } else if (servicePortResult.includes("success") || servicePortResult.includes("Index")) {
        console.log(`[SSH] Service-port created successfully`);
      }

      // Step 10: For Huawei ONUs, reset to force apply OMCI config (including WiFi)
      // WiFi config is pushed automatically via OMCI when using service profile with WLAN enabled
      if (!isGeneral) {
        console.log(`[SSH] Step 10: Resetting ONU to force apply OMCI config (WiFi)...`);
        try {
          // Need to enter GPON interface first
          await this.executeCommand("interface gpon " + String(frame) + "/" + String(slot));
          await this.delay(500);
          
          // ont reset command to force apply config - WiFi appears in ~30-60 seconds
          const resetCmd = "ont reset " + String(port) + " " + String(onuId);
          console.log(`[SSH] Executing: ${resetCmd}`);
          const resetResult = await this.executeCommand(resetCmd);
          console.log(`[SSH] Reset result: ${resetResult.substring(0, 100)}`);
          
          // Exit GPON interface
          await this.executeCommand("quit");
        } catch (resetErr) {
          console.log(`[SSH] Warning: ONU reset failed (non-critical): ${resetErr}`);
          // Non-critical - WiFi will still work, just takes longer to apply
        }
      }

      console.log(`[SSH] Successfully bound ONU ${serialNumber} as ID ${onuId} on ${gponPort}`);
      return { success: true, message: `ONU bound successfully as ID ${onuId}${!isGeneral ? " - WiFi will be ready in ~60 seconds" : ""}` };

    } catch (error) {
      console.error("[SSH] Error binding ONU:", error);
      return { success: false, message: error instanceof Error ? error.message : "Unknown error" };
    } finally {
      // Mark operation complete and start cooldown
      this.markOperationComplete();
      releaseLock!();
    }
  }

  async unbindOnu(onuId: number, gponPort: string, cleanConfig: boolean): Promise<{ success: boolean; message: string }> {
    if (!this.isConnected()) {
      return { success: false, message: "Not connected to OLT" };
    }

    // Wait for cooldown from any previous operation (includes waiting for pending ops)
    await this.waitForCooldown("Unbind");

    // Create operation lock
    let releaseLock: () => void;
    this.operationLock = new Promise<void>(resolve => { releaseLock = resolve; });

    try {
      // Parse port - format is "0/1/0" -> frame=0, slot=1, port=0
      const portParts = gponPort.split("/");
      if (portParts.length !== 3) {
        return { success: false, message: `Invalid port format: ${gponPort}` };
      }
      const [frame, slot, port] = portParts.map(p => parseInt(p));

      console.log(`[SSH] Unbinding ONU ${onuId} from port ${gponPort}, cleanConfig=${cleanConfig}`);
      console.log(`[SSH] Parsed port parts: frame=${frame}, slot=${slot}, port=${port}`);

      // CORRECT HUAWEI UNBIND SEQUENCE (from official docs):
      // 1. Enter config mode
      // 2. display service-port port F/S/P ont ONU_ID - find service ports
      // 3. undo service-port {id} - delete each service port (in config mode)
      // 4. interface gpon F/S - enter interface
      // 5. ont delete port ONU_ID - delete ONU
      // 6. quit and verify

      // Step 1: Ensure we're in config mode
      console.log(`[SSH] Step 1: Entering config mode...`);
      await this.executeCommand("quit");
      await this.executeCommand("quit"); // Double quit to ensure we're at base
      await this.executeCommand("config");
      
      // Step 2: Find service ports for this specific ONU
      // Use: display service-port port F/S/P ont ONU_ID
      const spCmd = "display service-port port " + String(frame) + "/" + String(slot) + "/" + String(port) + " ont " + String(onuId);
      console.log(`[SSH] Step 2: Finding service ports with: ${spCmd}`);
      const spOutput = await this.executeCommand(spCmd);
      console.log(`[SSH] Service port output:`);
      console.log(spOutput);
      
      // Parse service port IDs from output
      // Format: INDEX  VLAN  VLAN ATTR  PORT TYPE  F/S/P  VPI  VCI ...
      const servicePortIds: number[] = [];
      const lines = spOutput.split('\n');
      
      for (const line of lines) {
        const trimmedLine = line.trim();
        // Skip header lines, dashes, empty lines, and info messages
        if (!trimmedLine || 
            trimmedLine.startsWith('-') || 
            trimmedLine.startsWith('INDEX') || 
            trimmedLine.includes('Command:') || 
            trimmedLine.includes('display') ||
            trimmedLine.includes('Total:') ||
            trimmedLine.includes('No service virtual port') ||
            trimmedLine.includes('Unknown command') ||
            trimmedLine.includes('Error')) {
          continue;
        }
        
        const parts = trimmedLine.split(/\s+/);
        // First column should be the service-port index
        if (parts.length >= 1) {
          const spIndex = parseInt(parts[0]);
          if (!isNaN(spIndex) && spIndex >= 0) {
            servicePortIds.push(spIndex);
            console.log(`[SSH] Found service-port ID: ${spIndex}`);
          }
        }
      }
      
      // Step 3: Delete each service port (must be done in config mode BEFORE deleting ONT)
      if (servicePortIds.length > 0) {
        console.log(`[SSH] Step 3: Deleting ${servicePortIds.length} service port(s)...`);
        for (const spId of servicePortIds) {
          const undoCmd = "undo service-port " + String(spId);
          console.log(`[SSH] Executing: ${undoCmd}`);
          const undoResult = await this.executeCommand(undoCmd);
          console.log(`[SSH] Result: ${undoResult.substring(0, 200)}`);
          
          // Small delay between service-port deletions
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        console.log(`[SSH] Deleted ${servicePortIds.length} service port(s)`);
      } else {
        console.log(`[SSH] No service ports found for this ONU`);
      }

      // Step 4: Enter GPON interface
      console.log(`[SSH] Step 4: Entering interface gpon ${frame}/${slot}...`);
      const ifResult = await this.executeCommand("interface gpon " + String(frame) + "/" + String(slot));
      console.log(`[SSH] Interface result: ${ifResult.substring(0, 100)}`);
      
      // Step 5: Delete the ONU
      const deleteCmd = "ont delete " + String(port) + " " + String(onuId);
      console.log(`[SSH] Step 5: Deleting ONU with: ${deleteCmd}`);
      const deleteResult = await this.executeCommand(deleteCmd);
      console.log(`[SSH] Delete result: ${deleteResult}`);

      // Check for errors
      if (deleteResult.includes("service virtual ports")) {
        await this.executeCommand("quit");
        return { success: false, message: "ONU still has service ports that couldn't be deleted. Please delete manually first." };
      }
      
      if (deleteResult.includes("Failure") || deleteResult.includes("Unknown command")) {
        await this.executeCommand("quit");
        return { success: false, message: `Failed to delete ONU: ${deleteResult.substring(0, 200)}` };
      }

      // Exit interface
      await this.executeCommand("quit");
      
      // Step 6: Verify deletion
      console.log(`[SSH] Step 6: Verifying deletion...`);
      await this.executeCommand("interface gpon " + String(frame) + "/" + String(slot));
      const verifyCmd = "display ont info " + String(port) + " " + String(onuId);
      const verifyResult = await this.executeCommand(verifyCmd);
      await this.executeCommand("quit");
      
      const deleted = verifyResult.includes("does not exist") || 
                      verifyResult.includes("Failure") || 
                      verifyResult.includes("No related") ||
                      verifyResult.includes("not exist");
                      
      if (deleted) {
        console.log(`[SSH] Verified: ONU ${onuId} deleted successfully`);
      } else {
        console.log(`[SSH] Warning: ONU may still exist - ${verifyResult.substring(0, 150)}`);
      }

      console.log(`[SSH] Successfully unbound ONU ${onuId} from ${gponPort}`);
      return { success: true, message: `ONU ${onuId} unbound successfully` };
    } catch (error: any) {
      console.error("[SSH] Error unbinding ONU:", error);
      // Try to exit interface on error
      try {
        await this.executeCommand("quit");
      } catch (e) {
        // Ignore quit error
      }
      return { success: false, message: `Unbind failed: ${error.message}` };
    } finally {
      // Release the lock and mark operation complete
      this.operationLock = null;
      releaseLock!();
      this.markOperationComplete();
    }
  }
}

// Singleton instance
export const huaweiSSH = new HuaweiSSH();
