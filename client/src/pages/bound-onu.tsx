import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { BoundOnu } from "@shared/schema";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { OnuStatusBadge, ConfigStateBadge } from "@/components/onu-status-badge";
import { UnbindOnuDialog } from "@/components/unbind-onu-dialog";
import { OnuVerificationDialog } from "@/components/onu-verification-dialog";
import { Search, Link2, RefreshCw, MoreHorizontal, Trash2, Signal, Eye, CheckCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function BoundOnuPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedOnu, setSelectedOnu] = useState<BoundOnu | null>(null);
  const [unbindDialogOpen, setUnbindDialogOpen] = useState(false);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [verifyDialogOpen, setVerifyDialogOpen] = useState(false);

  const { data: boundOnus = [], isLoading, refetch, isFetching } = useQuery<BoundOnu[]>({
    queryKey: ["/api/onu/bound"],
    refetchInterval: 10000,
  });

  const filteredOnus = boundOnus.filter(
    (onu) =>
      onu.serialNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      onu.gponPort.toLowerCase().includes(searchQuery.toLowerCase()) ||
      onu.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleUnbindClick = (onu: BoundOnu) => {
    setSelectedOnu(onu);
    setUnbindDialogOpen(true);
  };

  const handleDetailsClick = (onu: BoundOnu) => {
    setSelectedOnu(onu);
    setDetailsDialogOpen(true);
  };

  const getSignalStrength = (rxPower?: number) => {
    if (rxPower === undefined) return { label: "Unknown", color: "text-gray-500" };
    if (rxPower >= -20) return { label: "Excellent", color: "text-green-500" };
    if (rxPower >= -25) return { label: "Good", color: "text-green-500" };
    if (rxPower >= -28) return { label: "Fair", color: "text-amber-500" };
    return { label: "Weak", color: "text-red-500" };
  };

  const statusCounts = {
    online: boundOnus.filter((o) => o.status === "online").length,
    offline: boundOnus.filter((o) => o.status === "offline").length,
    los: boundOnus.filter((o) => o.status === "los").length,
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Link2 className="h-6 w-6 text-muted-foreground" />
            Bound ONU
          </h1>
          <p className="text-muted-foreground mt-1">
            Configured and active devices
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="button-refresh-bound"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setVerifyDialogOpen(true)}
            data-testid="button-verify-bound"
          >
            <CheckCircle className="h-4 w-4 mr-2" />
            Verify ONU
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-500/10">
                <div className="h-3 w-3 rounded-full bg-green-500" />
              </div>
              <div>
                <p className="text-2xl font-semibold">{statusCounts.online}</p>
                <p className="text-sm text-muted-foreground">Online</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-500/10">
                <div className="h-3 w-3 rounded-full bg-gray-500" />
              </div>
              <div>
                <p className="text-2xl font-semibold">{statusCounts.offline}</p>
                <p className="text-sm text-muted-foreground">Offline</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/10">
                <div className="h-3 w-3 rounded-full bg-red-500" />
              </div>
              <div>
                <p className="text-2xl font-semibold">{statusCounts.los}</p>
                <p className="text-sm text-muted-foreground">LOS (Fiber Issue)</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <CardTitle className="text-base">Configured Devices</CardTitle>
              <CardDescription>
                {filteredOnus.length} device{filteredOnus.length !== 1 ? "s" : ""} bound
              </CardDescription>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by S/N, port, or description..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
                data-testid="input-search-bound"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : filteredOnus.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted mb-4">
                <Link2 className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="font-medium text-lg">No bound devices</h3>
              <p className="text-muted-foreground text-sm mt-1 max-w-sm">
                {searchQuery
                  ? "No devices match your search criteria"
                  : "No ONUs have been configured yet"}
              </p>
            </div>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ONU ID</TableHead>
                    <TableHead>Serial Number</TableHead>
                    <TableHead>GPON Port</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>RX Power</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredOnus.map((onu) => {
                    const signal = getSignalStrength(onu.rxPower);
                    return (
                      <TableRow key={onu.id} data-testid={`row-bound-${onu.serialNumber}`}>
                        <TableCell>
                          <Badge variant="secondary" className="font-mono">
                            {onu.onuId}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <code className="font-mono text-sm bg-muted px-1.5 py-0.5 rounded">
                            {onu.serialNumber}
                          </code>
                        </TableCell>
                        <TableCell>
                          <code className="font-mono text-sm">{onu.gponPort}</code>
                        </TableCell>
                        <TableCell>
                          <OnuStatusBadge status={onu.status} />
                        </TableCell>
                        <TableCell>
                          {onu.rxPower !== undefined ? (
                            <div className="flex items-center gap-1.5">
                              <Signal className={`h-3.5 w-3.5 ${signal.color}`} />
                              <span className={`font-mono text-sm ${signal.color}`}>
                                {onu.rxPower.toFixed(1)} dBm
                              </span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate">
                          {onu.description}
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" data-testid={`button-menu-${onu.serialNumber}`}>
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => handleDetailsClick(onu)} data-testid={`menu-details-${onu.serialNumber}`}>
                                <Eye className="h-4 w-4 mr-2" />
                                View Details
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => handleUnbindClick(onu)}
                                className="text-destructive focus:text-destructive"
                                data-testid={`menu-unbind-${onu.serialNumber}`}
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Unbind
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <UnbindOnuDialog
        open={unbindDialogOpen}
        onOpenChange={setUnbindDialogOpen}
        onu={selectedOnu}
      />

      <OnuVerificationDialog
        open={verifyDialogOpen}
        onOpenChange={setVerifyDialogOpen}
      />

      <Dialog open={detailsDialogOpen} onOpenChange={setDetailsDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>ONU Details</DialogTitle>
            <DialogDescription>
              Complete information for this device
            </DialogDescription>
          </DialogHeader>
          {selectedOnu && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Serial Number</p>
                  <p className="font-mono text-sm">{selectedOnu.serialNumber}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">ONU ID</p>
                  <p className="font-mono text-sm">{selectedOnu.onuId}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">GPON Port</p>
                  <p className="font-mono text-sm">{selectedOnu.gponPort}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Status</p>
                  <OnuStatusBadge status={selectedOnu.status} />
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Config State</p>
                  <ConfigStateBadge state={selectedOnu.configState} />
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Line Profile</p>
                  <Badge variant="outline">{selectedOnu.lineProfileId}</Badge>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Service Profile</p>
                  <Badge variant="outline">{selectedOnu.serviceProfileId}</Badge>
                </div>
                {selectedOnu.vlanId && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">VLAN</p>
                    <Badge variant="outline">{selectedOnu.vlanId}</Badge>
                  </div>
                )}
              </div>

              {(selectedOnu.rxPower !== undefined || selectedOnu.txPower !== undefined) && (
                <div className="border-t pt-4">
                  <p className="text-sm font-medium mb-3">Optical Info</p>
                  <div className="grid grid-cols-3 gap-4">
                    {selectedOnu.rxPower !== undefined && (
                      <div className="p-3 rounded-md bg-muted/50 text-center">
                        <p className="text-xs text-muted-foreground mb-1">RX Power</p>
                        <p className={`font-mono font-medium ${getSignalStrength(selectedOnu.rxPower).color}`}>
                          {selectedOnu.rxPower.toFixed(2)} dBm
                        </p>
                      </div>
                    )}
                    {selectedOnu.txPower !== undefined && (
                      <div className="p-3 rounded-md bg-muted/50 text-center">
                        <p className="text-xs text-muted-foreground mb-1">TX Power</p>
                        <p className="font-mono font-medium">
                          {selectedOnu.txPower.toFixed(2)} dBm
                        </p>
                      </div>
                    )}
                    {selectedOnu.distance !== undefined && (
                      <div className="p-3 rounded-md bg-muted/50 text-center">
                        <p className="text-xs text-muted-foreground mb-1">Distance</p>
                        <p className="font-mono font-medium">
                          {selectedOnu.distance} m
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="border-t pt-4">
                <p className="text-sm font-medium mb-2">Description</p>
                <p className="text-sm text-muted-foreground">{selectedOnu.description}</p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
