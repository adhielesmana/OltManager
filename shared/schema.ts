import { z } from "zod";

export const onuStatusSchema = z.enum(["online", "offline", "los", "auth-fail"]);
export type OnuStatus = z.infer<typeof onuStatusSchema>;

export const onuConfigStateSchema = z.enum(["normal", "failed", "initial"]);
export type OnuConfigState = z.infer<typeof onuConfigStateSchema>;

export const unboundOnuSchema = z.object({
  id: z.string(),
  serialNumber: z.string(),
  gponPort: z.string(),
  discoveredAt: z.string(),
  equipmentId: z.string().optional(),
  softwareVersion: z.string().optional(),
});
export type UnboundOnu = z.infer<typeof unboundOnuSchema>;

export const boundOnuSchema = z.object({
  id: z.string(),
  onuId: z.number(),
  serialNumber: z.string(),
  gponPort: z.string(),
  description: z.string(),
  lineProfileId: z.number(),
  serviceProfileId: z.number(),
  status: onuStatusSchema,
  configState: onuConfigStateSchema,
  rxPower: z.number().optional(),
  txPower: z.number().optional(),
  distance: z.number().optional(),
  boundAt: z.string(),
  vlanId: z.number().optional(),
  gemportId: z.number().optional(),
});
export type BoundOnu = z.infer<typeof boundOnuSchema>;

export const lineProfileSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string(),
  tcont: z.number(),
  gemportId: z.number(),
  mappingMode: z.string(),
});
export type LineProfile = z.infer<typeof lineProfileSchema>;

export const serviceProfileSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string(),
  portCount: z.number(),
  portType: z.string(),
});
export type ServiceProfile = z.infer<typeof serviceProfileSchema>;

export const vlanSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string(),
  type: z.enum(["smart", "mux", "standard"]),
  tagged: z.boolean(),
  inUse: z.boolean(),
});
export type Vlan = z.infer<typeof vlanSchema>;

export const bindOnuRequestSchema = z.object({
  serialNumber: z.string().min(1, "Serial number is required"),
  gponPort: z.string().min(1, "GPON port is required"),
  lineProfileId: z.number().min(1, "Line profile is required"),
  serviceProfileId: z.number().min(1, "Service profile is required"),
  description: z.string().min(1, "Description is required"),
  vlanId: z.number().optional(),
});
export type BindOnuRequest = z.infer<typeof bindOnuRequestSchema>;

export const unbindOnuRequestSchema = z.object({
  onuId: z.number(),
  gponPort: z.string(),
  cleanConfig: z.boolean().default(false),
  force: z.boolean().default(false),
});
export type UnbindOnuRequest = z.infer<typeof unbindOnuRequestSchema>;

export const onuVerificationSchema = z.object({
  serialNumber: z.string(),
  isUnbound: z.boolean(),
  isBound: z.boolean(),
  isOnline: z.boolean(),
  gponPort: z.string().optional(),
  onuId: z.number().optional(),
  rxPower: z.number().optional(),
  vlanAttached: z.boolean().optional(),
  message: z.string(),
});
export type OnuVerification = z.infer<typeof onuVerificationSchema>;

export const userRoleSchema = z.enum(["viewer", "provisioner", "admin"]);
export type UserRole = z.infer<typeof userRoleSchema>;

export const oltInfoSchema = z.object({
  product: z.string(),
  version: z.string(),
  patch: z.string(),
  uptime: z.string(),
});
export type OltInfo = z.infer<typeof oltInfoSchema>;
