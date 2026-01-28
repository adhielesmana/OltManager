import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { bindOnuRequestSchema, type BindOnuRequest, type LineProfile, type ServiceProfile, type UnboundOnu, type Vlan } from "@shared/schema";
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
import { Loader2, Shield, AlertTriangle, CheckCircle2 } from "lucide-react";
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
      serialNumber: selectedOnu?.serialNumber || "",
      gponPort: selectedOnu?.gponPort || "0/1/0",
      lineProfileId: 0,
      serviceProfileId: 0,
      description: "",
      vlanId: undefined,
      pppoeUsername: "",
      pppoePassword: "",
    },
  });

  const bindMutation = useMutation({
    mutationFn: async (data: BindOnuRequest) => {
      const response = await apiRequest("POST", "/api/onu/bind", data);
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "ONU Bound Successfully",
        description: "The ONU has been configured and is now active.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/onu/unbound"] });
      queryClient.invalidateQueries({ queryKey: ["/api/onu/unbound/count"] });
      queryClient.invalidateQueries({ queryKey: ["/api/onu/bound"] });
      onOpenChange(false);
      form.reset();
      setValidationStatus("idle");
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
    bindMutation.mutate(data);
  };

  const availableVlans = vlans.filter(v => !v.inUse);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Bind ONU
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
                    <FormLabel>VLAN (Optional)</FormLabel>
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
                            VLAN {v.id} - {v.name}
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
