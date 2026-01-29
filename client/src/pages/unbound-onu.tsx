import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import type { UnboundOnu } from "@shared/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { BindOnuDialog } from "@/components/bind-onu-dialog";
import { OnuVerificationDialog } from "@/components/onu-verification-dialog";
import { Search, Link2Off, Plus, RefreshCw, CheckCircle, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function UnboundOnuPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedOnu, setSelectedOnu] = useState<UnboundOnu | undefined>();
  const [bindDialogOpen, setBindDialogOpen] = useState(false);
  const [verifyDialogOpen, setVerifyDialogOpen] = useState(false);
  const { toast } = useToast();

  const { data: unboundOnus = [], isLoading, refetch, isFetching } = useQuery<UnboundOnu[]>({
    queryKey: ["/api/onu/unbound"],
  });

  const { data: refreshStatus } = useQuery<{ lastRefreshed: string | null; inProgress: boolean; error: string | null }>({
    queryKey: ["/api/olt/refresh/status"],
  });

  const reloadMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/onu/unbound/refresh");
      return res.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        toast({ title: "Reload Complete", description: data.message });
        queryClient.invalidateQueries({ queryKey: ["/api/onu/unbound"] });
        queryClient.invalidateQueries({ queryKey: ["/api/onu/unbound/count"] });
      } else {
        toast({ title: "Reload Failed", description: data.message, variant: "destructive" });
      }
    },
    onError: (error: Error) => {
      toast({ title: "Reload Error", description: error.message, variant: "destructive" });
    },
  });

  const formatLastRefresh = (dateStr: string | null) => {
    if (!dateStr) return "Never";
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
  };

  const filteredOnus = unboundOnus.filter(
    (onu) =>
      onu.serialNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      onu.gponPort.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (onu.equipmentId && onu.equipmentId.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const handleBindClick = (onu?: UnboundOnu) => {
    setSelectedOnu(onu);
    setBindDialogOpen(true);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Link2Off className="h-6 w-6 text-muted-foreground" />
            Unbound ONU
          </h1>
          <p className="text-muted-foreground mt-1">
            Discovered devices waiting for configuration
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mr-2">
            <Clock className="h-4 w-4" />
            <span>Last sync: {formatLastRefresh(refreshStatus?.lastRefreshed || null)}</span>
            {refreshStatus?.error && (
              <Badge variant="destructive" className="text-xs">{refreshStatus.error}</Badge>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => reloadMutation.mutate()}
            disabled={reloadMutation.isPending}
            data-testid="button-refresh-unbound"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${reloadMutation.isPending ? "animate-spin" : ""}`} />
            {reloadMutation.isPending ? "Reloading..." : "Reload"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setVerifyDialogOpen(true)}
            data-testid="button-verify-onu"
          >
            <CheckCircle className="h-4 w-4 mr-2" />
            Verify ONU
          </Button>
          <Button onClick={() => handleBindClick()} data-testid="button-bind-new">
            <Plus className="h-4 w-4 mr-2" />
            Bind ONU
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <CardTitle className="text-base">Discovered Devices</CardTitle>
              <CardDescription>
                {filteredOnus.length} device{filteredOnus.length !== 1 ? "s" : ""} found in autofind
              </CardDescription>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by S/N or port..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
                data-testid="input-search-unbound"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : filteredOnus.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted mb-4">
                <Link2Off className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="font-medium text-lg">No unbound devices</h3>
              <p className="text-muted-foreground text-sm mt-1 max-w-sm">
                {searchQuery
                  ? "No devices match your search criteria"
                  : "All discovered devices have been configured or none are in autofind"}
              </p>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Serial Number</TableHead>
                    <TableHead>GPON Port</TableHead>
                    <TableHead>Equipment ID</TableHead>
                    <TableHead>Discovered</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredOnus.map((onu) => (
                    <TableRow key={onu.id} data-testid={`row-unbound-${onu.serialNumber}`}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <code className="font-mono text-sm bg-muted px-1.5 py-0.5 rounded">
                            {onu.serialNumber}
                          </code>
                          {onu.equipmentId && onu.equipmentId !== "Unknown" && (
                            <Badge variant="secondary" className="text-xs font-medium">
                              {onu.equipmentId}
                            </Badge>
                          )}
                          <Badge variant="outline" className="bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20 text-xs">
                            New
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell>
                        <code className="font-mono text-sm">{onu.gponPort}</code>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {onu.equipmentId || "-"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDistanceToNow(new Date(onu.discoveredAt), { addSuffix: true })}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          onClick={() => handleBindClick(onu)}
                          data-testid={`button-bind-${onu.serialNumber}`}
                        >
                          Bind
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <BindOnuDialog
        open={bindDialogOpen}
        onOpenChange={setBindDialogOpen}
        selectedOnu={selectedOnu}
      />

      <OnuVerificationDialog
        open={verifyDialogOpen}
        onOpenChange={setVerifyDialogOpen}
      />
    </div>
  );
}
