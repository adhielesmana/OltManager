import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { OnuVerification } from "@shared/schema";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, CheckCircle2, XCircle, AlertTriangle, Signal } from "lucide-react";

interface OnuVerificationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function OnuVerificationDialog({ open, onOpenChange }: OnuVerificationDialogProps) {
  const [serialNumber, setSerialNumber] = useState("");
  const [result, setResult] = useState<OnuVerification | null>(null);

  const verifyMutation = useMutation({
    mutationFn: async (sn: string) => {
      const response = await apiRequest("GET", `/api/onu/verify/${sn}`);
      return response.json() as Promise<OnuVerification>;
    },
    onSuccess: (data) => {
      setResult(data);
    },
    onError: () => {
      setResult(null);
    },
  });

  const handleVerify = () => {
    if (serialNumber.trim()) {
      verifyMutation.mutate(serialNumber.trim());
    }
  };

  const handleClose = () => {
    setSerialNumber("");
    setResult(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Search className="h-5 w-5 text-primary" />
            ONU Verification
          </DialogTitle>
          <DialogDescription>
            Check if an ONU is new, unbound, or already in use
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="Enter ONU Serial Number"
              value={serialNumber}
              onChange={(e) => setSerialNumber(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && handleVerify()}
              className="font-mono"
              data-testid="input-verify-sn"
            />
            <Button
              onClick={handleVerify}
              disabled={!serialNumber.trim() || verifyMutation.isPending}
              data-testid="button-verify"
            >
              {verifyMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Check"
              )}
            </Button>
          </div>

          {result && (
            <div className="rounded-lg border bg-card p-4 space-y-4">
              <div className="flex items-center gap-3">
                {result.isUnbound ? (
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-500/10">
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                  </div>
                ) : result.isBound ? (
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/10">
                    <AlertTriangle className="h-5 w-5 text-amber-600" />
                  </div>
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-500/10">
                    <XCircle className="h-5 w-5 text-gray-600" />
                  </div>
                )}
                <div>
                  <p className="font-medium">{result.serialNumber}</p>
                  <p className="text-sm text-muted-foreground">{result.message}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1 p-2 rounded-md bg-muted/50">
                  <span className="text-xs text-muted-foreground">Status</span>
                  <div className="flex items-center gap-1.5">
                    {result.isUnbound ? (
                      <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">
                        Unconfigured
                      </Badge>
                    ) : result.isBound ? (
                      <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/20">
                        Already Bound
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-gray-500/10 text-gray-600 border-gray-500/20">
                        Not Found
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-1 p-2 rounded-md bg-muted/50">
                  <span className="text-xs text-muted-foreground">Online Status</span>
                  <div className="flex items-center gap-1.5">
                    {result.isOnline ? (
                      <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">
                        Online
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/20">
                        Offline / LOS
                      </Badge>
                    )}
                  </div>
                </div>

                {result.gponPort && (
                  <div className="flex flex-col gap-1 p-2 rounded-md bg-muted/50">
                    <span className="text-xs text-muted-foreground">GPON Port</span>
                    <span className="font-mono text-sm">{result.gponPort}</span>
                  </div>
                )}

                {result.onuId !== undefined && (
                  <div className="flex flex-col gap-1 p-2 rounded-md bg-muted/50">
                    <span className="text-xs text-muted-foreground">ONU ID</span>
                    <span className="font-mono text-sm">{result.onuId}</span>
                  </div>
                )}

                {result.rxPower !== undefined && (
                  <div className="flex flex-col gap-1 p-2 rounded-md bg-muted/50">
                    <span className="text-xs text-muted-foreground">RX Power</span>
                    <div className="flex items-center gap-1.5">
                      <Signal className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className={`font-mono text-sm ${result.rxPower < -28 ? "text-red-500" : result.rxPower < -25 ? "text-amber-500" : "text-green-500"}`}>
                        {result.rxPower.toFixed(1)} dBm
                      </span>
                    </div>
                  </div>
                )}

                {result.vlanAttached !== undefined && (
                  <div className="flex flex-col gap-1 p-2 rounded-md bg-muted/50">
                    <span className="text-xs text-muted-foreground">VLAN</span>
                    <Badge variant="outline" className={result.vlanAttached ? "bg-green-500/10 text-green-600 border-green-500/20" : "bg-gray-500/10 text-gray-600 border-gray-500/20"}>
                      {result.vlanAttached ? "Attached" : "Not Attached"}
                    </Badge>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
