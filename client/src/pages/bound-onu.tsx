import { useState, useMemo } from "react";
import { useQuery, useMutation, keepPreviousData } from "@tanstack/react-query";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { OnuStatusBadge, ConfigStateBadge } from "@/components/onu-status-badge";
import { UnbindOnuDialog } from "@/components/unbind-onu-dialog";
import { OnuVerificationDialog } from "@/components/onu-verification-dialog";
import { Search, Link2, RefreshCw, MoreHorizontal, Trash2, Signal, Eye, CheckCircle, Clock, ArrowUpDown, ChevronLeft, ChevronRight, Filter } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type SortField = "onuId" | "serialNumber" | "gponPort" | "status" | "rxPower" | "description";
type SortDirection = "asc" | "desc";

export default function BoundOnuPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedOnu, setSelectedOnu] = useState<BoundOnu | null>(null);
  const [unbindDialogOpen, setUnbindDialogOpen] = useState(false);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [verifyDialogOpen, setVerifyDialogOpen] = useState(false);
  const { toast } = useToast();

  // Filter states
  const [portFilter, setPortFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Sort states
  const [sortField, setSortField] = useState<SortField>("gponPort");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const { data: boundOnus = [], isLoading, isFetching } = useQuery<BoundOnu[]>({
    queryKey: ["/api/onu/bound"],
    refetchOnWindowFocus: false, // Don't refetch when switching tabs
    placeholderData: keepPreviousData, // Keep previous data visible while refetching
  });

  const { data: refreshStatus } = useQuery<{ lastRefreshed: string | null; inProgress: boolean; error: string | null }>({
    queryKey: ["/api/olt/refresh/status"],
  });

  const reloadMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/onu/bound/refresh");
      return res.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        toast({ title: "Reload Complete", description: data.message });
        queryClient.invalidateQueries({ queryKey: ["/api/onu/bound"] });
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

  // Get unique GPON ports for filter dropdown
  const uniquePorts = useMemo(() => {
    const ports = Array.from(new Set(boundOnus.map(o => o.gponPort)));
    return ports.sort((a, b) => {
      const [, slotA, portA] = a.split("/").map(Number);
      const [, slotB, portB] = b.split("/").map(Number);
      if (slotA !== slotB) return slotA - slotB;
      return portA - portB;
    });
  }, [boundOnus]);

  // Filter, sort, and paginate
  const { filteredOnus, paginatedOnus, totalPages, totalFiltered } = useMemo(() => {
    // Apply filters
    let result = boundOnus.filter((onu) => {
      // Search filter
      const matchesSearch =
        onu.serialNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
        onu.gponPort.toLowerCase().includes(searchQuery.toLowerCase()) ||
        onu.description.toLowerCase().includes(searchQuery.toLowerCase());

      // Port filter
      const matchesPort = portFilter === "all" || onu.gponPort === portFilter;

      // Status filter
      const matchesStatus = statusFilter === "all" || onu.status === statusFilter;

      return matchesSearch && matchesPort && matchesStatus;
    });

    const totalFiltered = result.length;

    // Apply sorting
    result = [...result].sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case "onuId":
          comparison = a.onuId - b.onuId;
          break;
        case "serialNumber":
          comparison = a.serialNumber.localeCompare(b.serialNumber);
          break;
        case "gponPort":
          const [, slotA, portA] = a.gponPort.split("/").map(Number);
          const [, slotB, portB] = b.gponPort.split("/").map(Number);
          comparison = slotA !== slotB ? slotA - slotB : portA - portB;
          if (comparison === 0) comparison = a.onuId - b.onuId;
          break;
        case "status":
          const statusOrder: Record<string, number> = { online: 0, offline: 1, los: 2, "auth-fail": 3 };
          comparison = (statusOrder[a.status] ?? 4) - (statusOrder[b.status] ?? 4);
          break;
        case "rxPower":
          const rxA = a.rxPower ?? -999;
          const rxB = b.rxPower ?? -999;
          comparison = rxB - rxA; // Higher (less negative) is better
          break;
        case "description":
          comparison = a.description.localeCompare(b.description);
          break;
      }
      return sortDirection === "asc" ? comparison : -comparison;
    });

    // Calculate pagination
    const totalPages = Math.ceil(result.length / pageSize);
    const startIndex = (currentPage - 1) * pageSize;
    const paginatedOnus = result.slice(startIndex, startIndex + pageSize);

    return { filteredOnus: result, paginatedOnus, totalPages, totalFiltered };
  }, [boundOnus, searchQuery, portFilter, statusFilter, sortField, sortDirection, currentPage, pageSize]);

  // Reset to first page when filters change
  const handleFilterChange = (type: "port" | "status", value: string) => {
    if (type === "port") setPortFilter(value);
    else setStatusFilter(value);
    setCurrentPage(1);
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
    setCurrentPage(1);
  };

  const SortableHeader = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <TableHead
      className="cursor-pointer hover:bg-muted/50 select-none"
      onClick={() => handleSort(field)}
    >
      <div className="flex items-center gap-1">
        {children}
        <ArrowUpDown className={`h-3 w-3 ${sortField === field ? "text-foreground" : "text-muted-foreground/50"}`} />
      </div>
    </TableHead>
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
            data-testid="button-refresh-bound"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${reloadMutation.isPending ? "animate-spin" : ""}`} />
            {reloadMutation.isPending ? "Reloading..." : "Reload"}
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
          <div className="flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <CardTitle className="text-base">Configured Devices</CardTitle>
                <CardDescription>
                  {totalFiltered} of {boundOnus.length} device{boundOnus.length !== 1 ? "s" : ""} shown
                </CardDescription>
              </div>
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by S/N, port, or description..."
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                  className="pl-9"
                  data-testid="input-search-bound"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Filters:</span>
              </div>
              <Select value={portFilter} onValueChange={(v) => handleFilterChange("port", v)}>
                <SelectTrigger className="w-[140px] h-8" data-testid="select-port-filter">
                  <SelectValue placeholder="All Ports" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Ports</SelectItem>
                  {uniquePorts.map(port => (
                    <SelectItem key={port} value={port}>{port}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={(v) => handleFilterChange("status", v)}>
                <SelectTrigger className="w-[130px] h-8" data-testid="select-status-filter">
                  <SelectValue placeholder="All Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="online">Online</SelectItem>
                  <SelectItem value="offline">Offline</SelectItem>
                  <SelectItem value="los">LOS</SelectItem>
                </SelectContent>
              </Select>
              <Select value={pageSize.toString()} onValueChange={(v) => { setPageSize(Number(v)); setCurrentPage(1); }}>
                <SelectTrigger className="w-[100px] h-8" data-testid="select-page-size">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10 / page</SelectItem>
                  <SelectItem value="25">25 / page</SelectItem>
                  <SelectItem value="50">50 / page</SelectItem>
                  <SelectItem value="100">100 / page</SelectItem>
                </SelectContent>
              </Select>
              {(portFilter !== "all" || statusFilter !== "all" || searchQuery) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setPortFilter("all"); setStatusFilter("all"); setSearchQuery(""); setCurrentPage(1); }}
                  className="h-8 text-xs"
                  data-testid="button-clear-filters"
                >
                  Clear filters
                </Button>
              )}
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
          ) : totalFiltered === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted mb-4">
                <Link2 className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="font-medium text-lg">No bound devices</h3>
              <p className="text-muted-foreground text-sm mt-1 max-w-sm">
                {searchQuery || portFilter !== "all" || statusFilter !== "all"
                  ? "No devices match your filter criteria"
                  : "No ONUs have been configured yet"}
              </p>
            </div>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableHeader field="onuId">ONU ID</SortableHeader>
                    <SortableHeader field="serialNumber">Serial Number</SortableHeader>
                    <SortableHeader field="gponPort">GPON Port</SortableHeader>
                    <SortableHeader field="status">Status</SortableHeader>
                    <SortableHeader field="rxPower">RX Power</SortableHeader>
                    <SortableHeader field="description">Description</SortableHeader>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedOnus.map((onu) => {
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
                          {onu.rxPower !== undefined && onu.rxPower !== null ? (
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
                          <div className="flex items-center justify-end gap-1">
                            {(onu.status === "offline" || onu.status === "los") && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleUnbindClick(onu)}
                                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                title="Remove orphan ONU"
                                data-testid={`button-remove-orphan-${onu.serialNumber}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
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
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 pt-4 border-t">
              <div className="text-sm text-muted-foreground">
                Showing {((currentPage - 1) * pageSize) + 1} - {Math.min(currentPage * pageSize, totalFiltered)} of {totalFiltered}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(1)}
                  disabled={currentPage === 1}
                  data-testid="button-first-page"
                >
                  First
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  data-testid="button-prev-page"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm px-2">
                  Page {currentPage} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  data-testid="button-next-page"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(totalPages)}
                  disabled={currentPage === totalPages}
                  data-testid="button-last-page"
                >
                  Last
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <UnbindOnuDialog
        open={unbindDialogOpen}
        onOpenChange={setUnbindDialogOpen}
        onu={selectedOnu}
        onReload={() => reloadMutation.mutate()}
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
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">VLAN</p>
                  <Badge variant="outline">{selectedOnu.vlanId || "N/A"}</Badge>
                </div>
              </div>

              {(selectedOnu.pppoeUsername || selectedOnu.pppoePassword) && (
                <div className="border-t pt-4">
                  <p className="text-sm font-medium mb-3">PPPoE Configuration</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Username</p>
                      <p className="font-mono text-sm">{selectedOnu.pppoeUsername || "N/A"}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Password</p>
                      <p className="font-mono text-sm">{selectedOnu.pppoePassword || "N/A"}</p>
                    </div>
                  </div>
                </div>
              )}

              {(selectedOnu.wifiSsid || selectedOnu.wifiPassword) && (
                <div className="border-t pt-4">
                  <p className="text-sm font-medium mb-3">WiFi Configuration</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">SSID (Network Name)</p>
                      <p className="font-mono text-sm">{selectedOnu.wifiSsid || "N/A"}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Password</p>
                      <p className="font-mono text-sm">{selectedOnu.wifiPassword || "N/A"}</p>
                    </div>
                  </div>
                </div>
              )}

              {((selectedOnu.rxPower !== undefined && selectedOnu.rxPower !== null) || (selectedOnu.txPower !== undefined && selectedOnu.txPower !== null)) && (
                <div className="border-t pt-4">
                  <p className="text-sm font-medium mb-3">Optical Info</p>
                  <div className="grid grid-cols-3 gap-4">
                    {selectedOnu.rxPower !== undefined && selectedOnu.rxPower !== null && (
                      <div className="p-3 rounded-md bg-muted/50 text-center">
                        <p className="text-xs text-muted-foreground mb-1">RX Power</p>
                        <p className={`font-mono font-medium ${getSignalStrength(selectedOnu.rxPower).color}`}>
                          {selectedOnu.rxPower.toFixed(2)} dBm
                        </p>
                      </div>
                    )}
                    {selectedOnu.txPower !== undefined && selectedOnu.txPower !== null && (
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
