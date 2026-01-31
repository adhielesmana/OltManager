import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { bindOnuRequestSchema, type BindOnuRequest, type LineProfile, type ServiceProfile, type UnboundOnu, type Vlan, type OnuType } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Shield, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface BindOnuDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedOnu?: UnboundOnu;
}

export function BindOnuDialog({ open, onOpenChange, selectedOnu }: BindOnuDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [validationStatus, setValidationStatus] = useState<"idle" | "validating" | "valid" | "invalid">("idle");

  const { data: lineProfiles = [] } = useQuery<LineProfile[]>({
    queryKey: ["/api/profiles/line"],
  });

  const { data: serviceProfiles = [] } = useQuery<ServiceProfile[]>({
    queryKey: ["/api/profiles/service"],
  });

  const { data: vlans = [] } = useQuery<Vlan[]>({
    queryKey: ["/api/vlans"],
  });

  // Fetch TR-069 ACS profiles from database
  const { data: tr069Profiles = [], isLoading: tr069Loading } = useQuery<{ id: number; name: string; acsUrl?: string }[]>({
    queryKey: ["/api/tr069-profiles"],
  });

  // Auto-refresh TR-069 profiles if none exist when dialog opens
  const [tr069AutoRefreshed, setTr069AutoRefreshed] = useState(false);
  const refreshTr069Mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/tr069-profiles/refresh");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tr069-profiles"] });
    },
  });

  useEffect(() => {
    if (open && !tr069Loading && tr069Profiles.length === 0 && !tr069AutoRefreshed && !refreshTr069Mutation.isPending) {
      setTr069AutoRefreshed(true);
      refreshTr069Mutation.mutate();
    }
    if (!open) {
      setTr069AutoRefreshed(false);
    }
  }, [open, tr069Loading, tr069Profiles.length, tr069AutoRefreshed, refreshTr069Mutation.isPending]);

  const { data: gponPorts = [] } = useQuery<string[]>({
    queryKey: ["/api/gpon-ports"],
  });

  const [selectedPort, setSelectedPort] = useState(selectedOnu?.gponPort || "0/1/0");

  const { data: nextOnuIdData } = useQuery<{ nextId: number; maxId: number }>({
    queryKey: ["/api/onu/next-id", selectedPort.replace(/\//g, "-")],
    enabled: !!selectedPort,
  });

  const form = useForm<BindOnuRequest>({
    resolver: zodResolver(bindOnuRequestSchema),
    defaultValues: {
      serialNumber: "",
      gponPort: "0/1/0",
      lineProfileId: 0,
      serviceProfileId: 0,
      description: "",
      vlanId: undefined,
      pppoeUsername: "",
      pppoePassword: "",
      onuType: "huawei",
      managementVlanId: undefined,
      tr069ProfileName: "",
    },
  });

  const selectedOnuType = form.watch("onuType");

  // Reset form when dialog opens with selected ONU
  useEffect(() => {
    if (open && selectedOnu) {
      form.reset({
        serialNumber: selectedOnu.serialNumber || "",
        gponPort: selectedOnu.gponPort || "0/1/0",
        lineProfileId: 0,
        serviceProfileId: 0,
        description: "",
        vlanId: undefined,
        pppoeUsername: "",
        pppoePassword: "",
        onuType: "huawei",
        managementVlanId: undefined,
        tr069ProfileName: "",
      });
      setSelectedPort(selectedOnu.gponPort || "0/1/0");
      setValidationStatus("idle");
    } else if (open && !selectedOnu) {
      form.reset({
        serialNumber: "",
        gponPort: "0/1/0",
        lineProfileId: 0,
        serviceProfileId: 0,
        description: "",
        vlanId: undefined,
        pppoeUsername: "",
        pppoePassword: "",
        onuType: "huawei",
        managementVlanId: undefined,
        tr069ProfileName: "",
      });
      setSelectedPort("0/1/0");
      setValidationStatus("idle");
    }
  }, [open, selectedOnu, form]);

  const bindMutation = useMutation({
    mutationFn: async (data: BindOnuRequest) => {
      const response = await apiRequest("POST", "/api/onu/bind", data);
      return response.json();
    },
    onSuccess: () => {
      // Refresh tables in background
      queryClient.invalidateQueries({ queryKey: ["/api/onu/unbound"] });
      queryClient.invalidateQueries({ queryKey: ["/api/onu/unbound/count"] });
      queryClient.invalidateQueries({ queryKey: ["/api/onu/bound"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Binding Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const validateMutation = useMutation({
    mutationFn: async (sn: string) => {
      const response = await apiRequest("POST", "/api/onu/validate", { serialNumber: sn });
      return response.json();
    },
    onSuccess: (data) => {
      if (data.canBind) {
        setValidationStatus("valid");
      } else {
        setValidationStatus("invalid");
        toast({
          title: "Cannot Bind ONU",
          description: data.reason,
          variant: "destructive",
        });
      }
    },
    onError: () => {
      setValidationStatus("invalid");
    },
  });

  const handleValidate = () => {
    const sn = form.getValues("serialNumber");
    if (sn) {
      setValidationStatus("validating");
      validateMutation.mutate(sn);
    }
  };

  const onSubmit = (data: BindOnuRequest) => {
    if (validationStatus !== "valid") {
      toast({
        title: "Validation Required",
        description: "Please validate the ONU before binding.",
        variant: "destructive",
      });
      return;
    }
    
    // For general ONUs, include the password from autofind
    const bindData: BindOnuRequest = {
      ...data,
      onuPassword: selectedOnu?.password || undefined,
    };
    
    // Start binding in background
    bindMutation.mutate(bindData);
    
    // Close dialog immediately and show toast
    toast({
      title: "Binding ONU...",
      description: "The ONU is being configured. The table will update automatically.",
    });
    onOpenChange(false);
    form.reset();
    setValidationStatus("idle");
  };

  // VLANs can be used by multiple ONUs - no filtering needed
  const availableVlans = vlans;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Bind ONU
            {selectedOnu?.equipmentId && selectedOnu.equipmentId !== "Unknown" && (
              <span className="text-sm font-normal text-muted-foreground">
                ({selectedOnu.equipmentId})
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            Configure a new ONU with safety validation. All fields are required.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="serialNumber"
                render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>Serial Number</FormLabel>
                    <div className="flex gap-2">
                      <FormControl>
                        <Input
                          placeholder="485754430A1B2C3D"
                          className="font-mono"
                          {...field}
                          data-testid="input-serial-number"
                        />
                      </FormControl>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleValidate}
                        disabled={!field.value || validateMutation.isPending}
                        data-testid="button-validate-onu"
                      >
                        {validateMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          "Validate"
                        )}
                      </Button>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {validationStatus === "valid" && (
                <Alert className="col-span-2 bg-green-500/10 border-green-500/20">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <AlertDescription className="text-green-600 dark:text-green-400">
                    ONU validated successfully. Ready to bind.
                  </AlertDescription>
                </Alert>
              )}

              {validationStatus === "invalid" && (
                <Alert className="col-span-2 bg-red-500/10 border-red-500/20">
                  <AlertTriangle className="h-4 w-4 text-red-600" />
                  <AlertDescription className="text-red-600 dark:text-red-400">
                    ONU validation failed. Check serial number.
                  </AlertDescription>
                </Alert>
              )}

              <FormField
                control={form.control}
                name="onuType"
                render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>ONU Type</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value || "huawei"}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-onu-type">
                          <SelectValue placeholder="Select ONU type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="huawei">Huawei ONU (OMCI binding)</SelectItem>
                        <SelectItem value="general">General ONU (Manual config)</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {selectedOnuType === "general" && (
                <Alert className="col-span-2 bg-blue-500/10 border-blue-500/20">
                  <Info className="h-4 w-4 text-blue-600" />
                  <AlertDescription className="text-blue-600 dark:text-blue-400">
                    General ONU will be registered without OMCI binding. Configure the ONU manually via its web interface after binding.
                  </AlertDescription>
                </Alert>
              )}

              <FormField
                control={form.control}
                name="gponPort"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>GPON Port</FormLabel>
                    <Select
                      onValueChange={(v) => {
                        field.onChange(v);
                        setSelectedPort(v);
                      }}
                      value={field.value || "0/1/0"}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-gpon-port" className="font-mono">
                          <SelectValue placeholder="Select port" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {gponPorts.map((port) => (
                          <SelectItem key={port} value={port} className="font-mono">
                            {port}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Next ONU ID: <span className="font-mono font-semibold">{nextOnuIdData?.nextId ?? "-"}</span> (max 127)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="lineProfileId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Line Profile</FormLabel>
                    <Select
                      onValueChange={(v) => field.onChange(parseInt(v))}
                      value={field.value?.toString() || ""}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-line-profile">
                          <SelectValue placeholder="Select profile" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {lineProfiles.map((p) => (
                          <SelectItem key={p.id} value={p.id.toString()}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="serviceProfileId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Service Profile</FormLabel>
                    <Select
                      onValueChange={(v) => field.onChange(parseInt(v))}
                      value={field.value?.toString() || ""}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-service-profile">
                          <SelectValue placeholder="Select profile" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {serviceProfiles.map((p) => (
                          <SelectItem key={p.id} value={p.id.toString()}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="vlanId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>PPPoE/Data VLAN</FormLabel>
                    <Select
                      onValueChange={(v) => field.onChange(v === "auto" ? undefined : parseInt(v))}
                      value={field.value?.toString() || "auto"}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-vlan">
                          <SelectValue placeholder="Auto-assign" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="auto">Auto-assign</SelectItem>
                        {availableVlans.map((v) => (
                          <SelectItem key={v.id} value={v.id.toString()}>
                            VLAN {v.vlanId} - {v.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="managementVlanId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Management VLAN (Optional)</FormLabel>
                    <Select
                      onValueChange={(v) => field.onChange(v === "none" ? undefined : parseInt(v))}
                      value={field.value?.toString() || "none"}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-management-vlan">
                          <SelectValue placeholder="None" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {availableVlans.map((v) => (
                          <SelectItem key={v.id} value={v.vlanId.toString()}>
                            VLAN {v.vlanId} - {v.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>DHCP management (ip-index 1)</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="tr069ProfileName"
                render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>TR-069 ACS Profile (Optional)</FormLabel>
                    <Select
                      onValueChange={(val) => field.onChange(val === "__none__" ? "" : val)}
                      value={field.value || "__none__"}
                      disabled={refreshTr069Mutation.isPending}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-tr069-profile">
                          <SelectValue placeholder={refreshTr069Mutation.isPending ? "Loading profiles..." : "Select ACS profile (optional)"} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="__none__">None</SelectItem>
                        {tr069Profiles.map((profile) => (
                          <SelectItem key={profile.id} value={profile.name}>
                            {profile.name}
                            {profile.acsUrl && (
                              <span className="text-muted-foreground text-xs ml-2">
                                ({profile.acsUrl})
                              </span>
                            )}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      {refreshTr069Mutation.isPending
                        ? "Loading ACS profiles from OLT..."
                        : tr069Profiles.length === 0 
                          ? "No ACS profiles on OLT" 
                          : "ACS server profile for remote management"}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Customer name, location, or notes..."
                        className="resize-none"
                        {...field}
                        data-testid="input-description"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="pppoeUsername"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>PPPoE Username (Optional)</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="user@isp.com"
                        {...field}
                        data-testid="input-pppoe-username"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="pppoePassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>PPPoE Password (Optional)</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="********"
                        {...field}
                        data-testid="input-pppoe-password"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                data-testid="button-cancel-bind"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={bindMutation.isPending || validationStatus !== "valid"}
                data-testid="button-confirm-bind"
              >
                {bindMutation.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Bind ONU
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
