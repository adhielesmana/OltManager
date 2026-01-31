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

  // Get timeout based on command type - heavy commands need longer timeouts
  private getCommandTimeout(command: string): number {
    const lowerCmd = command.toLowerCase();
    // Heavy commands that may take longer
    if (lowerCmd.includes("display ont info") || 
        lowerCmd.includes("display ont optical") ||
        lowerCmd.includes("display ont autofind") ||
        lowerCmd.includes("display vlan all") ||
        lowerCmd.includes("display board")) {
      return 30000; // 30 seconds for heavy commands
    }
    if (lowerCmd === "quit" || lowerCmd === "n" || lowerCmd === "y") {
      return 5000; // 5 seconds for quit/confirmations
    }
    return 15000; // 15 seconds default
  }

  async executeCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.shell || !this.connected) {
        reject(new Error("Not connected to OLT"));
        return;
      }

      // Add to queue with command-specific timeout
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

    // Set timeout for command (varies by command type)
    if (this.commandTimeout) {
      clearTimeout(this.commandTimeout);
    }
    const timeout = this.getCommandTimeout(command);
    this.commandTimeout = setTimeout(() => {
      if (this.currentResolve) {
        console.log(`[SSH] Command timeout (${timeout}ms): ${command}`);
        this.currentResolve(this.shellBuffer);
        this.currentResolve = null;
        this.isExecuting = false;
        this.processQueue();
      }
    }, timeout);

    // Send command (screen-length is set once at session start)
    console.log(`[SSH] Executing: ${command}`);
    this.shell.write(command + "\n");
  }

  async getOltInfo(): Promise<OltInfo> {
    try {
      const output = await this.executeCommand("display version");
      
      // Parse "display version" output format:
      // VERSION : MA5801V100R022C10
      // PATCH   : SPH209
      // PRODUCT : MA5801-GP16-H2
      // Uptime is 10 day(s), 6 hour(s), 40 minute(s), 20 second(s)
      
      // Extract PRODUCT line: "PRODUCT : MA5801-GP16-H2"
      const productLineMatch = output.match(/PRODUCT\s*:\s*([^\n\r]+)/i);
      const product = productLineMatch ? productLineMatch[1].trim() : null;
      
      // Extract VERSION line and parse version number: "VERSION : MA5801V100R022C10"
      const versionLineMatch = output.match(/VERSION\s*:\s*([^\n\r]+)/i);
      let version = null;
      if (versionLineMatch) {
        // Extract V100R022C10 from MA5801V100R022C10
        const vMatch = versionLineMatch[1].match(/V\d+R\d+C\d+/i);
        version = vMatch ? vMatch[0] : versionLineMatch[1].trim();
      }
      
      // Extract PATCH line: "PATCH   : SPH209" (can be SPH, SPC, or other prefixes)
      const patchLineMatch = output.match(/PATCH\s*:\s*([^\n\r]+)/i);
      const patch = patchLineMatch ? patchLineMatch[1].trim() : null;
      
      // Extract uptime: "Uptime is 10 day(s), 6 hour(s), 40 minute(s), 20 second(s)"
      const uptimeMatch = output.match(/uptime is ([^\n\r]+)/i) || output.match(/Run time:([^\n\r]+)/i);
      
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
        product: product || "MA5801",
        version: version || "Unknown",
        patch: patch || "-",
        uptime: uptimeMatch ? uptimeMatch[1].trim() : "Unknown",
        connected: true,
        hostname: hostname || undefined,
        model: product || undefined,
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
          const boundOutput = await this.executeCommand("display ont info all");
          const bound = this.parseBoundOnus(boundOutput, `0/${slot}/0`);
          allBound.push(...bound);
          console.log(`[SSH] Found ${bound.length} bound ONUs on slot ${slot}`);
          
          // Get optical info for bound ONUs if any (stay in interface mode)
          if (bound.length > 0) {
            try {
              // Add delay to ensure shell buffer is clear after heavy display ont info command
              const opticalOutput = await this.executeCommandWithDelay("display ont optical-info all", 800);
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
  
  private parsePppoeConfig(onu: BoundOnu, output: string): void {
    // Parse PPPoE username from "display ont ipconfig" output
    // Format varies but look for: user-account username XXX or Username: XXX
    for (const line of output.split("\n")) {
      const trimmedLine = line.trim();
      
      // Match: user-account username XXXX
      const usernameMatch = trimmedLine.match(/user-account\s+username\s+(\S+)/i);
      if (usernameMatch) {
        onu.pppoeUsername = usernameMatch[1];
        console.log(`[SSH] Found PPPoE username for ONU ${onu.onuId}: "${onu.pppoeUsername}"`);
        return;
      }
      
      // Match: Username : XXXX or Username: XXXX
      const usernameMatch2 = trimmedLine.match(/Username\s*:\s*(\S+)/i);
      if (usernameMatch2) {
        onu.pppoeUsername = usernameMatch2[1];
        console.log(`[SSH] Found PPPoE username for ONU ${onu.onuId}: "${onu.pppoeUsername}"`);
        return;
      }
    }
  }
  
  private parseWifiInfo(onu: BoundOnu, output: string): void {
    // Parse WiFi SSID from "display ont wlan-info F/S/P ONT_ID" output
    // Example output format:
    // F/S/P               : 0/1/15
    // ONT ID              : 0
    // The total number of SSID : 2
    // -------------------------------------------------
    // SSID Index          : 1
    // SSID                : OLY
    // Wireless Standard   : IEEE 802.11b/g/n
    // -------------------------------------------------
    // SSID Index          : 5
    // SSID                : OLY-5G
    // Wireless Standard   : IEEE 802.11ac
    
    let foundSsid24: string | null = null;
    let foundSsid5G: string | null = null;
    let currentSsidIndex: number | null = null;
    
    console.log(`[SSH] Parsing wlan-info for ONU ${onu.onuId}`);
    
    for (const line of output.split("\n")) {
      const trimmedLine = line.trim();
      
      // Match SSID Index: 1 or 5 etc
      const indexMatch = trimmedLine.match(/^SSID\s+Index\s*:\s*(\d+)/i);
      if (indexMatch) {
        currentSsidIndex = parseInt(indexMatch[1], 10);
        continue;
      }
      
      // Match SSID: value (but not "SSID Index")
      // Format: "SSID                : OLY"
      const ssidMatch = trimmedLine.match(/^SSID\s*:\s*(.+)/i);
      if (ssidMatch) {
        const ssid = ssidMatch[1].trim();
        if (ssid && ssid !== "-" && ssid.length > 0) {
          // Determine if 2.4GHz or 5GHz based on:
          // 1. SSID Index (1=2.4GHz, 5=5GHz typically)
          // 2. Wireless Standard (802.11b/g/n = 2.4GHz, 802.11ac/ax = 5GHz)
          // 3. SSID name contains "5G"
          if (currentSsidIndex === 5 || ssid.toLowerCase().includes("5g")) {
            if (!foundSsid5G) foundSsid5G = ssid;
          } else {
            if (!foundSsid24) foundSsid24 = ssid;
          }
        }
      }
      
      // Also check Wireless Standard to help categorize
      const wirelessMatch = trimmedLine.match(/^Wireless\s+Standard\s*:\s*(.+)/i);
      if (wirelessMatch && currentSsidIndex !== null) {
        const standard = wirelessMatch[1].trim();
        // 802.11ac or 802.11ax are 5GHz standards
        if (standard.includes("802.11ac") || standard.includes("802.11ax")) {
          // This confirms the current SSID is 5GHz
        }
      }
    }
    
    // Update ONU with found SSIDs
    if (foundSsid24 || foundSsid5G) {
      if (foundSsid24 && foundSsid5G) {
        onu.wifiSsid = `${foundSsid24} / ${foundSsid5G}`;
      } else {
        onu.wifiSsid = foundSsid24 || foundSsid5G || undefined;
      }
      console.log(`[SSH] WiFi SSID for ONU ${onu.onuId}: "${onu.wifiSsid}"`);
    }
    // Note: Password is not shown in wlan-info output for security reasons
  }

  // Parse VLAN info from "display service-port gpon 0/slot" output and update ONUs
  private parseServicePortVlans(onus: BoundOnu[], output: string, slot: number): void {
    // Service port output format:
    // INDEX  VLAN  VLAN ATTR  PORT TYPE  F/S/P    VPI  VCI  FLOW PARA  FLOW TYPE  RX      TX      STATE
    // 0      100   common     gpon       0/1/0    -    0    1          -          -       -       up
    // We need to match port F/S/P and ONT ID to find VLAN for each ONU
    
    const lines = output.split("\n");
    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // Skip header lines and non-data lines
      if (!trimmedLine || 
          trimmedLine.startsWith("-") || 
          trimmedLine.startsWith("INDEX") ||
          trimmedLine.includes("Command:") ||
          trimmedLine.includes("Total:")) {
        continue;
      }
      
      // Parse service port line - format varies but typically:
      // INDEX VLAN ... F/S/P ... ONT ...
      // Try to extract port (0/slot/port) and ont id and vlan
      const parts = trimmedLine.split(/\s+/);
      if (parts.length < 5) continue;
      
      // First field is index, second is VLAN
      const vlanId = parseInt(parts[1]);
      if (isNaN(vlanId) || vlanId <= 0) continue;
      
      // Find the port pattern (e.g., 0/1/0) and ont pattern in the line
      const portMatch = trimmedLine.match(/0\/(\d+)\/(\d+)/);
      const ontMatch = trimmedLine.match(/ont\s*(\d+)/i) || trimmedLine.match(/\s(\d+)\s+\d+\s+\d+\s+/);
      
      if (portMatch) {
        const lineSlot = parseInt(portMatch[1]);
        const linePort = parseInt(portMatch[2]);
        
        if (lineSlot === slot) {
          // Try to find ONT ID - look for number after port
          let ontId = -1;
          
          // Look for "ont X" pattern or number after port
          const ontIdMatch = trimmedLine.match(/ont\s+(\d+)/i);
          if (ontIdMatch) {
            ontId = parseInt(ontIdMatch[1]);
          }
          
          if (ontId >= 0) {
            // Find matching ONU and update VLAN
            const matchingOnu = onus.find(o => 
              o.gponPort === `0/${lineSlot}/${linePort}` && o.onuId === ontId
            );
            if (matchingOnu && !matchingOnu.vlanId) {
              matchingOnu.vlanId = vlanId;
              console.log(`[SSH] Found VLAN ${vlanId} for ONU ${matchingOnu.onuId} on port ${matchingOnu.gponPort}`);
            }
          }
        }
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

  // Extract vendor ID from serial number (first 4 characters converted to ASCII)
  // E.g., "48575443XXXXXXXX" -> "HWTC" (Huawei), "5A544547XXXXXXXX" -> "ZTEG" (ZTE)
  private extractVendorId(serialNumber: string): string {
    if (!serialNumber || serialNumber.length < 8) return "Unknown";
    
    try {
      // First 8 hex chars = 4 ASCII characters (vendor ID)
      const hexVendor = serialNumber.substring(0, 8);
      let vendor = "";
      for (let i = 0; i < 8; i += 2) {
        const charCode = parseInt(hexVendor.substring(i, i + 2), 16);
        if (charCode >= 32 && charCode <= 126) { // Printable ASCII
          vendor += String.fromCharCode(charCode);
        }
      }
      return vendor || "Unknown";
    } catch {
      return "Unknown";
    }
  }

  private parseUnboundOnus(output: string, defaultPort: string = "0/0/0"): UnboundOnu[] {
    const onus: UnboundOnu[] = [];
    const lines = output.split("\n");
    
    // Track current ONU data for block format parsing
    let currentPort = defaultPort;
    let currentSn: string | null = null;
    let currentPassword: string | null = null;
    let currentEquipmentId: string | null = null;
    let currentVendorId: string | null = null;
    let currentSoftwareVersion: string | null = null;

    console.log("[SSH] Parsing autofind output, lines:", lines.length);
    console.log("[SSH] Raw autofind output:", output.substring(0, 1000));

    // Helper to finalize current ONU block
    const finalizeOnu = () => {
      if (currentSn && !onus.find(o => o.serialNumber === currentSn)) {
        const vendorId = currentVendorId || this.extractVendorId(currentSn);
        onus.push({
          id: currentSn,
          serialNumber: currentSn,
          gponPort: currentPort,
          equipmentId: currentEquipmentId || "Unknown",
          vendorId: vendorId,
          softwareVersion: currentSoftwareVersion || undefined,
          password: currentPassword || undefined,
          discoveredAt: new Date().toISOString(),
        });
        console.log(`[SSH] Parsed unbound ONU: SN=${currentSn}, Port=${currentPort}, Vendor=${vendorId}, Password=${currentPassword ? "present" : "none"}`);
      }
      // Reset for next ONU
      currentSn = null;
      currentPassword = null;
      currentEquipmentId = null;
      currentVendorId = null;
      currentSoftwareVersion = null;
    };

    for (const line of lines) {
      const trimmedLine = line.trim();
      const parts = trimmedLine.split(/\s+/);
      
      // Detect new ONU block (Number : X)
      if (trimmedLine.match(/^Number\s*:\s*\d+/i)) {
        finalizeOnu(); // Save previous ONU if any
        continue;
      }
      
      // Block format: F/S/P : 0/1/0
      const portMatch = trimmedLine.match(/^F\/S\/P\s*:\s*(\d+)\/\s*(\d+)\/(\d+)/i);
      if (portMatch) {
        currentPort = `${portMatch[1]}/${portMatch[2]}/${portMatch[3]}`;
        continue;
      }
      
      // Block format: Ont SN : 5A544547CC9ABB09 (ZTEG-CC9ABB09)
      const snLineMatch = trimmedLine.match(/^Ont\s+SN\s*:\s*([A-Fa-f0-9]{16})/i);
      if (snLineMatch) {
        currentSn = snLineMatch[1].toUpperCase();
        continue;
      }
      
      // Block format: Password : 0x4743433941424230390(GCC9ABB09)
      // Extract the hex password (0x...) for binding
      const passwordMatch = trimmedLine.match(/^Password\s*:\s*(0x[A-Fa-f0-9]+)/i);
      if (passwordMatch) {
        currentPassword = passwordMatch[1];
        continue;
      }
      
      // Block format: VendorID : ZTEG
      const vendorMatch = trimmedLine.match(/^VendorID\s*:\s*(\S+)/i);
      if (vendorMatch) {
        currentVendorId = vendorMatch[1].trim();
        continue;
      }
      
      // Block format: Ont EquipmentID : F609V5.3
      const equipIdMatch = trimmedLine.match(/^Ont\s+EquipmentID\s*:\s*(\S+)/i);
      if (equipIdMatch) {
        currentEquipmentId = equipIdMatch[1].trim();
        continue;
      }
      
      // Block format: Ont SoftwareVersion : V7.0.10P2N3
      const softVerMatch = trimmedLine.match(/^Ont\s+SoftwareVersion\s*:\s*(\S+)/i);
      if (softVerMatch) {
        currentSoftwareVersion = softVerMatch[1].trim();
        continue;
      }
      
      // Legacy Format 1: Port as first column
      // Example: 0/1/15  48575443XXXXXXXX  HG8310M  ...
      if (parts.length >= 2 && /^\d+\/\d+\/\d+$/.test(parts[0])) {
        const port = parts[0];
        const sn = parts[1];
        
        if (sn && /^[A-Fa-f0-9]{16}$/.test(sn)) {
          const equipmentId = parts[2] || "Unknown";
          const softwareVersion = parts[4] || undefined;
          const vendorId = this.extractVendorId(sn);
          
          if (!onus.find(o => o.serialNumber === sn.toUpperCase())) {
            onus.push({
              id: sn.toUpperCase(),
              serialNumber: sn.toUpperCase(),
              gponPort: port,
              equipmentId: equipmentId,
              vendorId: vendorId,
              softwareVersion: softwareVersion,
              discoveredAt: new Date().toISOString(),
            });
            console.log(`[SSH] Parsed unbound ONU (tabular): SN=${sn}, Port=${port}, Vendor=${vendorId}`);
          }
          continue;
        }
      }
      
      // Legacy Format 2: Number  F/S/P  SN  ...
      if (parts.length >= 3 && /^\d+$/.test(parts[0]) && /^\d+\/\d+\/\d+$/.test(parts[1])) {
        const port = parts[1];
        const sn = parts[2];
        
        if (sn && /^[A-Fa-f0-9]{16}$/.test(sn)) {
          const equipmentId = parts[3] || "Unknown";
          const vendorId = this.extractVendorId(sn);
          
          if (!onus.find(o => o.serialNumber === sn.toUpperCase())) {
            onus.push({
              id: sn.toUpperCase(),
              serialNumber: sn.toUpperCase(),
              gponPort: port,
              equipmentId: equipmentId,
              vendorId: vendorId,
              discoveredAt: new Date().toISOString(),
            });
          }
          continue;
        }
      }
    }
    
    // Finalize last ONU if any
    finalizeOnu();

    console.log(`[SSH] Parsed ${onus.length} unbound ONUs total`);
    return onus;
  }

  async getBoundOnus(): Promise<BoundOnu[]> {
    const allOnus: BoundOnu[] = [];
    try {
      // Detect which slots have GPON boards
      const gponSlots = await this.detectGponSlots();
      console.log(`[SSH] Getting bound ONUs from slots: ${gponSlots.join(", ")}`);
      
      // Get port count per slot (16 ports for most boards)
      const portsPerSlot = 16;
      
      // Scan each GPON slot
      for (const slot of gponSlots) {
        try {
          // Enter GPON interface for this slot
          await this.executeCommand(`interface gpon 0/${slot}`);
          
          const slotOnus: BoundOnu[] = [];
          
          // Scan each port (0-15) on this slot - "display ont info all" doesn't work, need per-port
          for (let port = 0; port < portsPerSlot; port++) {
            try {
              const output = await this.executeCommand(`display ont info ${port} all`);
              // Check if there's actual data (not just error message)
              if (!output.includes("Parameter error") && !output.includes("do not exist")) {
                const portOnus = this.parseBoundOnus(output, `0/${slot}/${port}`);
                if (portOnus.length > 0) {
                  console.log(`[SSH] Found ${portOnus.length} bound ONUs on port 0/${slot}/${port}`);
                  slotOnus.push(...portOnus);
                }
              }
            } catch (err) {
              // Port might not exist or have no ONUs - continue to next port
            }
          }
          
          console.log(`[SSH] Found ${slotOnus.length} total bound ONUs on slot ${slot}`);
          
          // Get optical info for all bound ONUs - use per-port queries to avoid onuId collisions
          // (same onuId can exist on different ports, e.g., ONU 0 on 0/1/0 and ONU 0 on 0/1/15)
          if (slotOnus.length > 0) {
            console.log(`[SSH] Getting optical info per-port for slot ${slot}`);
            // Find which ports have ONUs
            const portSet = new Set<number>();
            for (const o of slotOnus) {
              const parts = o.gponPort.split("/");
              portSet.add(parseInt(parts[2]) || 0);
            }
            const portsWithOnus = Array.from(portSet);
            
            for (const port of portsWithOnus) {
              const portOnus = slotOnus.filter(o => o.gponPort === `0/${slot}/${port}`);
              if (portOnus.length > 0) {
                try {
                  const opticalOutput = await this.executeCommandWithDelay(`display ont optical-info ${port} all`, 500);
                  if (!opticalOutput.includes("Unknown command") && !opticalOutput.includes("Error:")) {
                    this.enrichWithOpticalInfo(portOnus, opticalOutput);
                    console.log(`[SSH] Got optical info for ${portOnus.length} ONUs on port ${port}`);
                  }
                } catch (err) {
                  console.log(`[SSH] Optical info failed for port ${port}: ${err}`);
                }
              }
            }
            
            // Get descriptions, PPPoE and WiFi config for each ONU (limit to first 50 to avoid timeout)
            const onusToEnrich = slotOnus.slice(0, 50);
            console.log(`[SSH] Starting enrichment for ${onusToEnrich.length} ONUs on slot ${slot}`);
            for (const onu of onusToEnrich) {
              try {
                const portParts = onu.gponPort.split("/");
                const portNum = parseInt(portParts[2]) || 0;
                console.log(`[SSH] Enriching ONU ${onu.gponPort}/${onu.onuId} (port=${portNum})`);
                const detailOutput = await this.executeCommand(`display ont info ${portNum} ${onu.onuId}`);
                // Log first 300 chars of output for debugging
                console.log(`[SSH] display ont info ${portNum} ${onu.onuId} output (first 300 chars): ${detailOutput.substring(0, 300).replace(/\n/g, '\\n')}`);
                this.parseOnuDescription(onu, detailOutput);
                console.log(`[SSH] After parseOnuDescription: ONU ${onu.onuId} description="${onu.description || '(still empty)'}"`);
                
                // Get PPPoE config
                try {
                  const pppoeOutput = await this.executeCommand(`display ont ipconfig ${portNum} ${onu.onuId}`);
                  this.parsePppoeConfig(onu, pppoeOutput);
                } catch (pppoeErr) {
                  console.log(`[SSH] PPPoE config failed for ONU ${onu.onuId}: ${pppoeErr}`);
                }
                
                // Get WiFi info using "display ont wlan-info F/S/P ONT_ID"
                try {
                  const wifiOutput = await this.executeCommand(`display ont wlan-info ${portNum} ${onu.onuId}`);
                  this.parseWifiInfo(onu, wifiOutput);
                } catch (wifiErr) {
                  console.log(`[SSH] WiFi info failed for ONU ${onu.onuId}: ${wifiErr}`);
                }
              } catch (err) {
                console.log(`[SSH] Could not get description for ONU ${onu.onuId}: ${err}`);
              }
            }
          }
          
          // Exit interface
          await this.executeCommand("quit");
          
          // Fetch VLAN info from service-port for all ONUs on this slot
          try {
            await this.executeCommand("config");
            const spOutput = await this.executeCommand(`display service-port gpon 0/${slot}`);
            this.parseServicePortVlans(slotOnus, spOutput, slot);
            await this.executeCommand("quit");
          } catch (spErr) {
            console.log(`[SSH] Could not fetch service-port info for slot ${slot}`);
            try { await this.executeCommand("quit"); } catch {}
          }
          
          // Log enriched ONUs before adding to final list
          for (const onu of slotOnus) {
            console.log(`[SSH] Enriched ONU ${onu.gponPort}/${onu.onuId}: desc="${onu.description}", pppoe="${onu.pppoeUsername}"`);
          }
          
          // Add enriched ONUs to final list AFTER all enrichment is complete
          allOnus.push(...slotOnus);
        } catch (err) {
          console.error(`[SSH] Error scanning slot ${slot}:`, err);
          try { await this.executeCommand("quit"); } catch {}
        }
      }
      
      console.log(`[SSH] Total bound ONUs found: ${allOnus.length}`);
      return allOnus;
    } catch (err) {
      console.error("[SSH] Error getting bound ONUs:", err);
      return [];
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
      // Huawei MA5801 optical info format (inside interface gpon mode):
      // ONT-ID  Rx Power(dBm)  Tx Power(dBm)  OLT Rx ONT(dBm)  Laser Bias  Temperature  Voltage  Distance
      // 0       -17.51         2.34           -18.92           12.00       45           3.30     1234
      //
      // We want: OLT Rx ONT (column 4) as rxPower (signal strength at OLT)
      //          Tx Power (column 3) as txPower (ONU's transmit power)
      
      // Match line with ONT-ID followed by at least 4 numeric columns
      // Pattern: ONT-ID  col1  col2  col3  col4...
      const match1 = line.match(/^\s*(\d+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)/);
      
      if (match1) {
        const onuId = parseInt(match1[1]);
        // Column order: ONT-ID, Rx(ONU), Tx(ONU), OLT-Rx-ONT, ...
        const onuRxPower = parseFloat(match1[2]);  // ONU's Rx (less useful)
        const onuTxPower = parseFloat(match1[3]);  // ONU's Tx power
        const oltRxPower = parseFloat(match1[4]);  // OLT receives from ONU (THIS IS WHAT WE WANT)
        
        // Find the ONU by ID (assumes we're in a specific port context)
        const onu = onus.find(o => o.onuId === onuId);
        if (onu && !isNaN(oltRxPower)) {
          // Use OLT Rx power as the main signal indicator
          onu.rxPower = oltRxPower;
          onu.txPower = isNaN(onuTxPower) ? undefined : onuTxPower;
          console.log(`[SSH] Enriched ONU ${onuId}: oltRx=${oltRxPower}dBm, onuTx=${onuTxPower}dBm (onuRx=${onuRxPower}dBm)`);
          foundCount++;
        }
        continue;
      }
      
      // Fallback: Try to match with fewer columns (older format or different firmware)
      // Example: 0  -17.51  2.34  -18.92
      const match2 = line.match(/^\s*(\d+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)/);
      if (match2) {
        const onuId = parseInt(match2[1]);
        const col1 = parseFloat(match2[2]);
        const col2 = parseFloat(match2[3]);
        const col3 = parseFloat(match2[4]);
        
        const onu = onus.find(o => o.onuId === onuId);
        if (onu && !isNaN(col3)) {
          // Assume col3 is OLT Rx power
          onu.rxPower = col3;
          onu.txPower = isNaN(col2) ? undefined : col2;
          console.log(`[SSH] Enriched ONU ${onuId} (fallback): rx=${col3}dBm, tx=${col2}dBm`);
          foundCount++;
        }
        continue;
      }
      
      // Format with F/S/P port format (may have spaces in port notation)
      // Example: 0/ 1/15   0      -17.51         2.34           -17.89
      const match3 = line.match(/^\s*(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)\s+(\d+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)/);
      
      if (match3) {
        const port = `${match3[1]}/${match3[2]}/${match3[3]}`;
        const onuId = parseInt(match3[4]);
        const col1 = parseFloat(match3[5]);
        const col2 = parseFloat(match3[6]);
        const col3 = parseFloat(match3[7]);
        
        const onu = onus.find(o => o.gponPort === port && o.onuId === onuId);
        if (onu) {
          onu.rxPower = isNaN(col3) ? undefined : col3;  // OLT Rx power
          onu.txPower = isNaN(col2) ? undefined : col2;  // ONU Tx power
          console.log(`[SSH] Enriched ONU ${port}/${onuId}: rx=${col3}dBm, tx=${col2}dBm`);
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
            vlanId: id, // Actual VLAN ID
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

  // Get TR-069 ACS profiles from OLT
  async getTr069Profiles(): Promise<{ name: string; acsUrl?: string; username?: string }[]> {
    try {
      console.log("[SSH] Fetching TR-069 profiles...");
      
      // Execute display tr069-server-config all command
      const output = await this.executeCommand("display tr069-server-config all");
      console.log(`[SSH] TR-069 profiles raw output:\n${output.substring(0, 500)}`);
      
      return this.parseTr069Profiles(output);
    } catch (err) {
      console.error("[SSH] Error getting TR-069 profiles:", err);
      return [];
    }
  }

  private parseTr069Profiles(output: string): { name: string; acsUrl?: string; username?: string }[] {
    const profiles: { name: string; acsUrl?: string; username?: string }[] = [];
    const lines = output.split("\n");
    
    let currentProfile: { name: string; acsUrl?: string; username?: string } | null = null;
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Match profile name line: "Profile-name : SURGE_ACS" or "Profile name : SURGE_ACS"
      const nameMatch = trimmed.match(/^Profile[- ]?name\s*:\s*(.+)/i);
      if (nameMatch) {
        // Save previous profile if exists
        if (currentProfile && currentProfile.name) {
          profiles.push(currentProfile);
        }
        currentProfile = { name: nameMatch[1].trim() };
        continue;
      }
      
      // Match ACS URL: "ACS URL : http://acs.example.com:7547"
      const urlMatch = trimmed.match(/^ACS\s+URL\s*:\s*(.+)/i);
      if (urlMatch && currentProfile) {
        currentProfile.acsUrl = urlMatch[1].trim();
        continue;
      }
      
      // Match Username: "Username : admin"
      const userMatch = trimmed.match(/^Username\s*:\s*(.+)/i);
      if (userMatch && currentProfile) {
        currentProfile.username = userMatch[1].trim();
        continue;
      }
    }
    
    // Don't forget last profile
    if (currentProfile && currentProfile.name) {
      profiles.push(currentProfile);
    }
    
    console.log(`[SSH] Parsed ${profiles.length} TR-069 profiles:`, profiles.map(p => p.name));
    return profiles;
  }

  // Create TR-069 ACS profile on OLT
  async createTr069Profile(params: {
    name: string;
    acsUrl: string;
    username?: string;
    password?: string;
    periodicInterval?: number;
  }): Promise<{ success: boolean; message: string }> {
    if (!this.isConnected()) {
      return { success: false, message: "No active OLT connection" };
    }

    try {
      console.log(`[SSH] Creating TR-069 profile: ${params.name}`);
      
      // Enter config mode first
      await this.executeCommandWithDelay("config");
      
      // Create or enter the TR-069 profile
      await this.executeCommandWithDelay(`tr069-server-config profile-name ${params.name}`);
      
      // Set ACS URL
      await this.executeCommandWithDelay(`acs-url ${params.acsUrl}`);
      
      // Set username if provided
      if (params.username) {
        await this.executeCommandWithDelay(`acs-username ${params.username}`);
      }
      
      // Set password if provided
      if (params.password) {
        await this.executeCommandWithDelay(`acs-password ${params.password}`);
      }
      
      // Set periodic interval if provided (default is usually 86400 = 1 day)
      if (params.periodicInterval) {
        await this.executeCommandWithDelay(`periodic-inform-interval ${params.periodicInterval}`);
      }
      
      // Exit TR-069 config and config mode
      await this.executeCommandWithDelay("quit");
      await this.executeCommandWithDelay("quit");
      
      console.log(`[SSH] TR-069 profile ${params.name} created successfully`);
      return { success: true, message: `TR-069 profile '${params.name}' created successfully` };
    } catch (err) {
      console.error("[SSH] Error creating TR-069 profile:", err);
      // Try to exit any config modes
      try {
        await this.executeCommand("quit");
        await this.executeCommand("quit");
      } catch {}
      return { success: false, message: `Failed to create TR-069 profile: ${err instanceof Error ? err.message : "Unknown error"}` };
    }
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
    wifiSsid?: string;
    wifiPassword?: string;
    enableRemoteAccess?: boolean;
    onuPassword?: string; // Hex password from autofind for general ONUs (e.g., "0x4743433941424230390")
    managementVlanId?: number; // Optional management VLAN for DHCP (e.g., 81)
    tr069ProfileName?: string; // Optional TR-069 ACS profile (e.g., "SURGE_ACS")
  }): Promise<{ success: boolean; message: string; wifiSsid?: string; wifiPassword?: string }> {
    if (!this.isConnected()) {
      return { success: false, message: "Not connected to OLT" };
    }

    // Wait for cooldown from any previous operation
    await this.waitForCooldown("Bind");

    // Create operation lock
    let releaseLock: () => void;
    this.operationLock = new Promise<void>(resolve => { releaseLock = resolve; });

    try {
      const { 
        serialNumber, gponPort, onuId, lineProfileName, serviceProfileName, 
        description, vlanId, gemportId, pppoeUsername, pppoePassword, 
        onuType = "huawei", wifiSsid, wifiPassword, enableRemoteAccess = true,
        onuPassword, managementVlanId, tr069ProfileName
      } = params;
      
      // Default WiFi credentials - fixed names for all ONUs
      const defaultSsid24 = wifiSsid || "MaxnetPlus";
      const defaultSsid5G = "MaxnetPlus5G";
      const defaultPassword = wifiPassword || "MaxnetWifi";
      
      // Parse port - format is "0/1/0" -> frame=0, slot=1, port=0
      const portParts = gponPort.split("/");
      if (portParts.length !== 3) {
        return { success: false, message: `Invalid port format: ${gponPort}` };
      }
      const [frame, slot, port] = portParts.map(p => parseInt(p));

      const isGeneral = onuType === "general";
      console.log(`[SSH] Binding ${isGeneral ? "General" : "Huawei"} ONU ${serialNumber} to port ${gponPort} as ONU ID ${onuId}`);
      console.log(`[SSH] Profiles: line=${lineProfileName}, service=${serviceProfileName}, vlan=${vlanId}`);
      if (managementVlanId) console.log(`[SSH] Management VLAN: ${managementVlanId}`);
      if (tr069ProfileName) console.log(`[SSH] TR-069 Profile: ${tr069ProfileName}`);

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
      // General ONU: uses password-auth with hex password from autofind (no OMCI)
      let addCmd: string;
      if (isGeneral) {
        // General ONU - register with password-auth (manual configuration via ONU web interface)
        // Command: ont add 0 1 sn-auth [SN] password-auth [hex password] omci ont-lineprofile-name [profile] ont-srvprofile-name [profile] desc "DESCRIPTION"
        addCmd = "ont add " + slotPort + 
          " sn-auth " + serialNumber;
        
        // Add password-auth if password is provided from autofind
        if (onuPassword) {
          addCmd += " password-auth " + onuPassword;
        }
        
        addCmd += " omci ont-lineprofile-name " + lineProfileName + 
          " ont-srvprofile-name " + serviceProfileName + 
          " desc " + description.replace(/\s+/g, "_").substring(0, 32);
        console.log(`[SSH] Step 3: Adding General ONU with: ${addCmd.replace(onuPassword || "", "****")}`);
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

      // Step 8a: Configure Management VLAN with DHCP (ip-index 1) if specified
      if (managementVlanId && !isGeneral) {
        console.log(`[SSH] Step 8a: Configuring Management VLAN ${managementVlanId} with DHCP (ip-index 1)...`);
        // ont ipconfig PORT ONU_ID ip-index 1 dhcp vlan VLAN priority 0
        const mgmtDhcpCmd = "ont ipconfig " + slotPort + " ip-index 1 dhcp vlan " + String(managementVlanId) + " priority 0";
        console.log(`[SSH] Management DHCP command: ${mgmtDhcpCmd}`);
        const mgmtDhcpResult = await this.executeCommandWithDelay(mgmtDhcpCmd, 800);
        console.log(`[SSH] Management DHCP result: ${mgmtDhcpResult.substring(0, 200)}`);
      }

      // Step 8b: Configure TR-069 ACS profile if specified (works for both Huawei and General ONUs)
      if (tr069ProfileName) {
        console.log(`[SSH] Step 8b: Configuring TR-069 ACS profile "${tr069ProfileName}"...`);
        // ont tr069-server-config PORT ONU_ID profile-name PROFILE
        const tr069Cmd = "ont tr069-server-config " + slotPort + " profile-name " + tr069ProfileName;
        console.log(`[SSH] TR-069 command: ${tr069Cmd}`);
        const tr069Result = await this.executeCommandWithDelay(tr069Cmd, 800);
        console.log(`[SSH] TR-069 result: ${tr069Result.substring(0, 200)}`);
      }

      // Exit GPON interface first
      await this.executeCommand("quit");

      // Step 9a: Create service-port for Management VLAN (if specified)
      // Format: service-port vlan [MGMT_VLAN] gpon [F/S/P] ont [ONU_ID] gemport [GEMPORT] multi-service user-vlan [MGMT_VLAN] tag-transform translate
      if (managementVlanId) {
        console.log(`[SSH] Step 9a: Creating service-port for Management VLAN ${managementVlanId} (tag-transform translate)...`);
        const mgmtServicePortCmd = "service-port vlan " + String(managementVlanId) + 
          " gpon " + gponPort + 
          " ont " + String(onuId) + 
          " gemport " + String(gemportId) + " multi-service user-vlan " + String(managementVlanId) + 
          " tag-transform translate";
        console.log(`[SSH] Management service-port command: ${mgmtServicePortCmd}`);
        const mgmtServicePortResult = await this.executeCommandWithDelay(mgmtServicePortCmd, 800);
        console.log(`[SSH] Management service-port result:\n${mgmtServicePortResult.substring(0, 200)}`);
        
        if (mgmtServicePortResult.includes("Failure") || mgmtServicePortResult.includes("Error")) {
          console.error(`[SSH] WARNING: Management service-port creation failed: ${mgmtServicePortResult.substring(0, 200)}`);
        } else {
          console.log(`[SSH] Management service-port created successfully`);
        }
      }

      // Step 9b: Create service-port for Data VLAN
      // Huawei ONU (PPPoE router mode): user LAN is untagged, ONU adds VLAN tag → translate
      // General ONU (bridge mode): VLAN passes through unchanged, DHCP from ISP router → transparent
      const dataTagTransform = isGeneral ? "transparent" : "translate";
      console.log(`[SSH] Step 9b: Creating service-port for Data VLAN ${vlanId} (tag-transform ${dataTagTransform})...`);
      const servicePortCmd = "service-port vlan " + String(vlanId) + 
        " gpon " + gponPort + 
        " ont " + String(onuId) + 
        " gemport " + String(gemportId) + " multi-service user-vlan " + String(vlanId) + 
        " tag-transform " + dataTagTransform;
      console.log(`[SSH] Data service-port command: ${servicePortCmd}`);
      const servicePortResult = await this.executeCommandWithDelay(servicePortCmd, 800);
      console.log(`[SSH] Data service-port result:\n${servicePortResult.substring(0, 200)}`);

      if (servicePortResult.includes("Failure") || servicePortResult.includes("Error") || servicePortResult.includes("error")) {
        console.error(`[SSH] ERROR: Data service-port creation failed: ${servicePortResult}`);
        // Don't return failure - the ONU is already bound, just log warning
      } else if (servicePortResult.includes("success") || servicePortResult.includes("Index")) {
        console.log(`[SSH] Data service-port created successfully`);
      }

      // Step 10: Configure WiFi SSID and Password for Huawei ONUs via OMCI
      // Configure both 2.4GHz (ssid-index 0) and 5GHz (ssid-index 1)
      if (!isGeneral) {
        console.log(`[SSH] Step 10: Configuring WiFi 2.4GHz="${defaultSsid24}" 5GHz="${defaultSsid5G}" Password="${defaultPassword}"...`);
        try {
          // Enter GPON interface first
          await this.executeCommand("interface gpon " + String(frame) + "/" + String(slot));
          await this.delay(500);
          
          // Configure 2.4GHz WiFi (ssid-index 0)
          // Format: ont wlan-cfg PORT ONU_ID ssid-index 0 ssid-name SSID authentication-mode wpa2-psk psk-password PASSWORD
          const wifi24Cmd = "ont wlan-cfg " + slotPort + 
            " ssid-index 0 ssid-name " + defaultSsid24 + 
            " authentication-mode wpa2-psk psk-password " + defaultPassword;
          console.log(`[SSH] 2.4GHz WiFi: ont wlan-cfg ${slotPort} ssid-index 0 ssid-name ${defaultSsid24} authentication-mode wpa2-psk psk-password ****`);
          const wifi24Result = await this.executeCommand(wifi24Cmd);
          console.log(`[SSH] 2.4GHz WiFi result: ${wifi24Result.substring(0, 200)}`);
          
          await this.delay(500);
          
          // Configure 5GHz WiFi (ssid-index 1)
          const wifi5GCmd = "ont wlan-cfg " + slotPort + 
            " ssid-index 1 ssid-name " + defaultSsid5G + 
            " authentication-mode wpa2-psk psk-password " + defaultPassword;
          console.log(`[SSH] 5GHz WiFi: ont wlan-cfg ${slotPort} ssid-index 1 ssid-name ${defaultSsid5G} authentication-mode wpa2-psk psk-password ****`);
          const wifi5GResult = await this.executeCommand(wifi5GCmd);
          console.log(`[SSH] 5GHz WiFi result: ${wifi5GResult.substring(0, 200)}`);
          
          // Exit interface for next step
          await this.executeCommand("quit");
        } catch (wifiErr) {
          console.log(`[SSH] Warning: WiFi config failed (non-critical, ONU may not support WLAN): ${wifiErr}`);
        }
      }

      // Step 11: Enable remote ONU management from WAN side (HTTP/HTTPS access)
      if (enableRemoteAccess && !isGeneral) {
        console.log(`[SSH] Step 11: Enabling remote ONU access from WAN side...`);
        try {
          // Enter GPON interface
          await this.executeCommand("interface gpon " + String(frame) + "/" + String(slot));
          await this.delay(500);
          
          // Enable remote management via WAN
          // ont remote-admin PORT ONU_ID http-enable https-enable
          const remoteCmd = "ont remote-admin " + slotPort + " http-enable https-enable";
          console.log(`[SSH] Remote access command: ${remoteCmd}`);
          const remoteResult = await this.executeCommand(remoteCmd);
          console.log(`[SSH] Remote access result: ${remoteResult.substring(0, 200)}`);
          
          // Alternative command if the above doesn't work: ont wan-admin
          if (remoteResult.includes("Unknown") || remoteResult.includes("Invalid")) {
            const altRemoteCmd = "ont wan-admin " + slotPort + " enable";
            console.log(`[SSH] Trying alternative: ${altRemoteCmd}`);
            const altResult = await this.executeCommand(altRemoteCmd);
            console.log(`[SSH] Alt remote access result: ${altResult.substring(0, 200)}`);
          }
          
          // Exit interface
          await this.executeCommand("quit");
        } catch (remoteErr) {
          console.log(`[SSH] Warning: Remote access config failed (non-critical): ${remoteErr}`);
        }
      }

      // Step 12: For Huawei ONUs, reset to force apply OMCI config (including WiFi)
      if (!isGeneral) {
        console.log(`[SSH] Step 12: Resetting ONU to force apply OMCI config...`);
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
      const wifiInfo = !isGeneral ? ` | WiFi: ${defaultSsid24} / ${defaultSsid5G} | Password: ${defaultPassword}` : "";
      return { 
        success: true, 
        message: `ONU bound successfully as ID ${onuId}${!isGeneral ? " - WiFi will be ready in ~60 seconds" : ""}${wifiInfo}`,
        wifiSsid: !isGeneral ? `${defaultSsid24} / ${defaultSsid5G}` : undefined,
        wifiPassword: !isGeneral ? defaultPassword : undefined
      };

    } catch (error) {
      console.error("[SSH] Error binding ONU:", error);
      return { success: false, message: error instanceof Error ? error.message : "Unknown error" };
    } finally {
      // Mark operation complete and start cooldown
      this.markOperationComplete();
      releaseLock!();
    }
  }

  async unbindOnu(serialNumber: string, onuId: number, gponPort: string, cleanConfig: boolean): Promise<{ success: boolean; message: string }> {
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

      console.log(`[SSH] Unbinding ONU ${serialNumber} from port ${gponPort}, cleanConfig=${cleanConfig}`);
      console.log(`[SSH] Parsed port parts: frame=${frame}, slot=${slot}, port=${port}`);

      // HUAWEI UNBIND SEQUENCE:
      // 1. Enter config mode
      // 2. undo service-port port F/S/P ont OnuID - delete all service ports for this ONU
      // 3. interface gpon F/S - enter interface
      // 4. ont delete PortID OnuID - delete ONU
      // 5. quit and verify

      // Step 1: Ensure we're in config mode (enable -> config)
      console.log(`[SSH] Step 1: Entering config mode...`);
      await this.executeCommand("quit");
      await new Promise(resolve => setTimeout(resolve, 300));
      await this.executeCommand("quit");
      await new Promise(resolve => setTimeout(resolve, 300));
      await this.executeCommand("enable");
      await new Promise(resolve => setTimeout(resolve, 300));
      const configResult = await this.executeCommand("config");
      console.log(`[SSH] Config mode result: ${configResult.substring(0, 100)}`);
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Step 2: Find and delete all service ports for this ONU
      // First, find service-port indexes by querying: display service-port port F/S/P ont OnuID
      const findSpCmd = `display service-port port ${frame}/${slot}/${port} ont ${onuId}`;
      console.log(`[SSH] Step 2a: Finding service ports with: ${findSpCmd}`);
      const findSpResult = await this.executeCommandWithDelay(findSpCmd, 800);
      console.log(`[SSH] Service port query result: ${findSpResult.substring(0, 500)}`);
      
      // Parse service-port indexes from output
      // Format: INDEX  VLAN  VLAN TYPE  ...  F/S/P  ONT
      //         123    100   common     ...  0/1/0  0
      const spIndexes: number[] = [];
      const lines = findSpResult.split('\n');
      for (const line of lines) {
        // Match lines that start with a number (the service-port index)
        const match = line.trim().match(/^(\d+)\s+/);
        if (match) {
          const idx = parseInt(match[1]);
          if (!isNaN(idx) && idx > 0) {
            spIndexes.push(idx);
          }
        }
      }
      console.log(`[SSH] Found ${spIndexes.length} service-port indexes: ${spIndexes.join(', ')}`);
      
      // Delete each service-port by index
      for (const spIndex of spIndexes) {
        const undoSpCmd = `undo service-port ${spIndex}`;
        console.log(`[SSH] Step 2b: Deleting service-port ${spIndex} with: ${undoSpCmd}`);
        const undoResult = await this.executeCommandWithDelay(undoSpCmd, 800);
        console.log(`[SSH] Service-port ${spIndex} deletion result: ${undoResult.substring(0, 200)}`);
      }
      
      // If no service-ports found via query, try the bulk delete command as fallback
      if (spIndexes.length === 0) {
        const undoSpCmd = `undo service-port port ${frame}/${slot}/${port} ont ${onuId}`;
        console.log(`[SSH] Step 2c: Trying bulk service-port deletion: ${undoSpCmd}`);
        const undoSpResult = await this.executeCommandWithDelay(undoSpCmd, 800);
        console.log(`[SSH] Bulk service-port deletion result: ${undoSpResult.substring(0, 300)}`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 500));

      // Step 3: Enter GPON interface (config -> interface gpon F/S)
      const ifCmd = `interface gpon ${frame}/${slot}`;
      console.log(`[SSH] Step 3: Entering interface with: ${ifCmd}`);
      const ifResult = await this.executeCommandWithDelay(ifCmd, 800);
      console.log(`[SSH] Interface result: ${ifResult.substring(0, 200)}`);
      
      // Verify we're in interface mode
      if (ifResult.includes("Unknown command") || ifResult.includes("Error")) {
        console.log(`[SSH] Failed to enter interface mode, retrying...`);
        await this.executeCommand("quit");
        await new Promise(resolve => setTimeout(resolve, 500));
        await this.executeCommand("config");
        await new Promise(resolve => setTimeout(resolve, 500));
        await this.executeCommandWithDelay(ifCmd, 800);
      }
      
      // Step 4: Delete the ONU using "ont delete [PortID] [OnuID]" command
      // Must be inside interface gpon mode!
      const deleteCmd = `ont delete ${port} ${onuId}`;
      console.log(`[SSH] Step 4: Deleting ONU with: ${deleteCmd}`);
      const deleteResult = await this.executeCommandWithDelay(deleteCmd, 1000);
      console.log(`[SSH] Delete result: ${deleteResult.substring(0, 300)}`);

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
      
      // Step 5: Verify deletion
      console.log(`[SSH] Step 5: Verifying deletion...`);
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
