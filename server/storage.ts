import { randomUUID } from "crypto";
import type {
  UnboundOnu,
  BoundOnu,
  LineProfile,
  ServiceProfile,
  Vlan,
  OltInfo,
  BindOnuRequest,
  OnuVerification,
} from "@shared/schema";

export interface IStorage {
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

export class MemStorage implements IStorage {
  private unboundOnus: Map<string, UnboundOnu>;
  private boundOnus: Map<string, BoundOnu>;
  private lineProfiles: LineProfile[];
  private serviceProfiles: ServiceProfile[];
  private vlans: Vlan[];
  private oltInfo: OltInfo;

  constructor() {
    this.unboundOnus = new Map();
    this.boundOnus = new Map();
    
    this.oltInfo = {
      product: "MA5801-GP16",
      version: "V800R021C00",
      patch: "SPC100",
      uptime: "45 days, 12:34:56",
    };

    this.lineProfiles = [
      { id: 1, name: "FTTH-100M", description: "100 Mbps residential", tcont: 1, gemportId: 1, mappingMode: "vlan" },
      { id: 2, name: "FTTH-200M", description: "200 Mbps residential", tcont: 2, gemportId: 2, mappingMode: "vlan" },
      { id: 3, name: "FTTH-500M", description: "500 Mbps premium", tcont: 3, gemportId: 3, mappingMode: "vlan" },
      { id: 4, name: "FTTH-1G", description: "1 Gbps enterprise", tcont: 4, gemportId: 4, mappingMode: "vlan" },
      { id: 5, name: "BUSINESS-SLA", description: "Business with SLA", tcont: 5, gemportId: 5, mappingMode: "port" },
    ];

    this.serviceProfiles = [
      { id: 1, name: "ROUTER-1ETH", description: "Single ETH port router", portCount: 1, portType: "eth" },
      { id: 2, name: "ROUTER-4ETH", description: "4 ETH port router", portCount: 4, portType: "eth" },
      { id: 3, name: "HGU-WIFI", description: "Home Gateway with WiFi", portCount: 4, portType: "eth+wifi" },
      { id: 4, name: "BRIDGE-1ETH", description: "Bridge mode single port", portCount: 1, portType: "eth" },
      { id: 5, name: "VOIP-2PORT", description: "VoIP with 2 FXS ports", portCount: 2, portType: "fxs" },
    ];

    this.vlans = [
      { id: 100, name: "MGMT", description: "Management VLAN", type: "smart", tagged: true, inUse: true },
      { id: 200, name: "RESIDENTIAL", description: "Residential Internet", type: "smart", tagged: true, inUse: true },
      { id: 201, name: "RESIDENTIAL-2", description: "Residential Zone 2", type: "smart", tagged: true, inUse: false },
      { id: 300, name: "BUSINESS", description: "Business Internet", type: "smart", tagged: true, inUse: false },
      { id: 400, name: "VOIP", description: "Voice over IP", type: "smart", tagged: true, inUse: false },
      { id: 500, name: "IPTV", description: "IPTV Multicast", type: "mux", tagged: true, inUse: false },
      { id: 600, name: "GUEST", description: "Guest Network", type: "standard", tagged: false, inUse: false },
      { id: 700, name: "IOT", description: "IoT Devices", type: "standard", tagged: true, inUse: false },
    ];

    this.initializeSampleData();
  }

  private initializeSampleData() {
    const unboundSamples: UnboundOnu[] = [
      {
        id: randomUUID(),
        serialNumber: "485754430A1B2C01",
        gponPort: "0/1/0",
        discoveredAt: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
        equipmentId: "HG8546M",
        softwareVersion: "V5R020C00S115",
      },
      {
        id: randomUUID(),
        serialNumber: "485754430A1B2C02",
        gponPort: "0/1/0",
        discoveredAt: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
        equipmentId: "HG8245H",
        softwareVersion: "V5R019C00S122",
      },
      {
        id: randomUUID(),
        serialNumber: "485754430A1B2C03",
        gponPort: "0/1/1",
        discoveredAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
        equipmentId: "EG8145V5",
        softwareVersion: "V5R020C00S100",
      },
      {
        id: randomUUID(),
        serialNumber: "485754430A1B2C04",
        gponPort: "0/2/0",
        discoveredAt: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
        equipmentId: "HG8546M",
        softwareVersion: "V5R020C00S115",
      },
    ];

    unboundSamples.forEach(onu => {
      this.unboundOnus.set(onu.serialNumber, onu);
    });

    const boundSamples: BoundOnu[] = [
      {
        id: randomUUID(),
        onuId: 0,
        serialNumber: "485754430B1A2C01",
        gponPort: "0/1/0",
        description: "Customer: John Smith - 123 Main St",
        lineProfileId: 2,
        serviceProfileId: 3,
        status: "online",
        configState: "normal",
        rxPower: -18.5,
        txPower: 2.1,
        distance: 1250,
        boundAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString(),
        vlanId: 200,
        gemportId: 2,
      },
      {
        id: randomUUID(),
        onuId: 1,
        serialNumber: "485754430B1A2C02",
        gponPort: "0/1/0",
        description: "Customer: Jane Doe - 456 Oak Ave",
        lineProfileId: 1,
        serviceProfileId: 1,
        status: "online",
        configState: "normal",
        rxPower: -22.3,
        txPower: 2.0,
        distance: 3400,
        boundAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 15).toISOString(),
        vlanId: 200,
        gemportId: 1,
      },
      {
        id: randomUUID(),
        onuId: 2,
        serialNumber: "485754430B1A2C03",
        gponPort: "0/1/0",
        description: "Business: ABC Corp - Suite 100",
        lineProfileId: 4,
        serviceProfileId: 2,
        status: "online",
        configState: "normal",
        rxPower: -15.2,
        txPower: 2.3,
        distance: 850,
        boundAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7).toISOString(),
        vlanId: 300,
        gemportId: 4,
      },
      {
        id: randomUUID(),
        onuId: 3,
        serialNumber: "485754430B1A2C04",
        gponPort: "0/1/1",
        description: "Customer: Bob Wilson - 789 Pine Rd",
        lineProfileId: 3,
        serviceProfileId: 3,
        status: "offline",
        configState: "normal",
        rxPower: undefined,
        txPower: undefined,
        distance: 2100,
        boundAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 45).toISOString(),
        vlanId: 200,
        gemportId: 3,
      },
      {
        id: randomUUID(),
        onuId: 4,
        serialNumber: "485754430B1A2C05",
        gponPort: "0/1/1",
        description: "Customer: Alice Brown - 321 Elm St",
        lineProfileId: 2,
        serviceProfileId: 1,
        status: "los",
        configState: "normal",
        rxPower: undefined,
        txPower: undefined,
        distance: 4500,
        boundAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 60).toISOString(),
        vlanId: 200,
        gemportId: 2,
      },
      {
        id: randomUUID(),
        onuId: 0,
        serialNumber: "485754430B1A2C06",
        gponPort: "0/2/0",
        description: "Customer: Charlie Davis - 555 Maple Dr",
        lineProfileId: 1,
        serviceProfileId: 1,
        status: "online",
        configState: "normal",
        rxPower: -19.8,
        txPower: 2.2,
        distance: 1800,
        boundAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(),
        vlanId: 200,
        gemportId: 1,
      },
    ];

    boundSamples.forEach(onu => {
      this.boundOnus.set(onu.serialNumber, onu);
    });
  }

  async getOltInfo(): Promise<OltInfo> {
    return this.oltInfo;
  }

  async getUnboundOnus(): Promise<UnboundOnu[]> {
    return Array.from(this.unboundOnus.values()).sort(
      (a, b) => new Date(b.discoveredAt).getTime() - new Date(a.discoveredAt).getTime()
    );
  }

  async getUnboundOnuCount(): Promise<number> {
    return this.unboundOnus.size;
  }

  async getBoundOnus(): Promise<BoundOnu[]> {
    return Array.from(this.boundOnus.values()).sort((a, b) => {
      if (a.gponPort !== b.gponPort) {
        return a.gponPort.localeCompare(b.gponPort);
      }
      return a.onuId - b.onuId;
    });
  }

  async getLineProfiles(): Promise<LineProfile[]> {
    return this.lineProfiles;
  }

  async getServiceProfiles(): Promise<ServiceProfile[]> {
    return this.serviceProfiles;
  }

  async getVlans(): Promise<Vlan[]> {
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
    const onu = Array.from(this.boundOnus.values()).find(
      o => o.onuId === onuId && o.gponPort === gponPort
    );
    
    if (!onu) {
      throw new Error("ONU not found");
    }
    
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

export const storage = new MemStorage();
