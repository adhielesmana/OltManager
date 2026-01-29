import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { BoundOnu } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, AlertTriangle, Trash2 } from "lucide-react";

interface UnbindOnuDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onu: BoundOnu | null;
  onReload?: () => void;
}

export function UnbindOnuDialog({ open, onOpenChange, onu, onReload }: UnbindOnuDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [cleanConfig, setCleanConfig] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const unbindMutation = useMutation({
    mutationFn: async () => {
      if (!onu) throw new Error("No ONU selected");
      const response = await apiRequest("POST", "/api/onu/unbind", {
        onuId: onu.onuId,
        gponPort: onu.gponPort,
        cleanConfig,
        force: false,
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "ONU Unbound Successfully",
        description: cleanConfig 
          ? "ONU configuration has been cleaned and removed." 
          : "ONU has been removed from the system.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/onu/bound"] });
      queryClient.invalidateQueries({ queryKey: ["/api/onu/unbound"] });
      queryClient.invalidateQueries({ queryKey: ["/api/onu/unbound/count"] });
      onOpenChange(false);
      setCleanConfig(false);
      setConfirmDelete(false);
      // Trigger reload from OLT after unbind completes
      if (onReload) {
        onReload();
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Unbind Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleUnbind = () => {
    if (!confirmDelete) {
      toast({
        title: "Confirmation Required",
        description: "Please confirm the deletion checkbox.",
        variant: "destructive",
      });
      return;
    }
    unbindMutation.mutate();
  };

  if (!onu) return null;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-5 w-5" />
            Unbind ONU
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-4">
              <p>
                Are you sure you want to unbind this ONU? This action cannot be undone.
              </p>

              <div className="rounded-md bg-muted p-3 space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Serial Number:</span>
                  <span className="font-mono font-medium">{onu.serialNumber}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">ONU ID:</span>
                  <span className="font-mono">{onu.onuId}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">GPON Port:</span>
                  <span className="font-mono">{onu.gponPort}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Description:</span>
                  <span className="truncate max-w-[200px]">{onu.description}</span>
                </div>
              </div>

              <div className="flex items-center gap-3 p-3 rounded-md bg-amber-500/10 border border-amber-500/20">
                <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
                <p className="text-sm text-amber-700 dark:text-amber-400">
                  This will disconnect the customer immediately. Ensure proper communication.
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="clean-config"
                    checked={cleanConfig}
                    onCheckedChange={(checked) => setCleanConfig(checked === true)}
                    data-testid="checkbox-clean-config"
                  />
                  <Label htmlFor="clean-config" className="text-sm font-normal cursor-pointer">
                    Clean configuration (remove all ONU settings)
                  </Label>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="confirm-delete"
                    checked={confirmDelete}
                    onCheckedChange={(checked) => setConfirmDelete(checked === true)}
                    data-testid="checkbox-confirm-delete"
                  />
                  <Label htmlFor="confirm-delete" className="text-sm font-normal cursor-pointer text-destructive">
                    I understand this action is irreversible
                  </Label>
                </div>
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="button-cancel-unbind">Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleUnbind}
            disabled={unbindMutation.isPending || !confirmDelete}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            data-testid="button-confirm-unbind"
          >
            {unbindMutation.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Unbind ONU
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
