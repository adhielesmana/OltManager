import { useQuery, useMutation } from "@tanstack/react-query";
import type { Vlan } from "@shared/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Network, Search, CheckCircle, XCircle, RefreshCw } from "lucide-react";
import { useState } from "react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function VlansPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const { toast } = useToast();

  const { data: vlans = [], isLoading } = useQuery<Vlan[]>({
    queryKey: ["/api/vlans"],
  });

  const reloadMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/vlans/refresh");
      return res.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        toast({ title: "Reload Complete", description: data.message });
        queryClient.invalidateQueries({ queryKey: ["/api/vlans"] });
      } else {
        toast({ title: "Reload Failed", description: data.message, variant: "destructive" });
      }
    },
    onError: (error: Error) => {
      toast({ title: "Reload Error", description: error.message, variant: "destructive" });
    },
  });

  const filteredVlans = vlans.filter(
    (vlan) =>
      vlan.id.toString().includes(searchQuery) ||
      vlan.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      vlan.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const availableCount = vlans.filter(v => !v.inUse).length;
  const inUseCount = vlans.filter(v => v.inUse).length;

  const getTypeBadgeClass = (type: string) => {
    switch (type) {
      case "smart":
        return "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20";
      case "mux":
        return "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20";
      default:
        return "bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20";
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Network className="h-6 w-6 text-muted-foreground" />
            VLANs
          </h1>
          <p className="text-muted-foreground mt-1">
            Available VLANs for ONU service binding
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => reloadMutation.mutate()}
          disabled={reloadMutation.isPending}
          data-testid="button-refresh-vlans"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${reloadMutation.isPending ? "animate-spin" : ""}`} />
          {reloadMutation.isPending ? "Reloading..." : "Reload from OLT"}
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                <Network className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-semibold">{vlans.length}</p>
                <p className="text-sm text-muted-foreground">Total VLANs</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-500/10">
                <CheckCircle className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-semibold">{availableCount}</p>
                <p className="text-sm text-muted-foreground">Available</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/10">
                <XCircle className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <p className="text-2xl font-semibold">{inUseCount}</p>
                <p className="text-sm text-muted-foreground">In Use</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <CardTitle className="text-base">VLAN Configuration</CardTitle>
              <CardDescription>
                {filteredVlans.length} VLAN{filteredVlans.length !== 1 ? "s" : ""} configured
              </CardDescription>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by ID or name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
                data-testid="input-search-vlans"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : filteredVlans.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted mb-4">
                <Network className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="font-medium text-lg">No VLANs found</h3>
              <p className="text-muted-foreground text-sm mt-1">
                {searchQuery
                  ? "No VLANs match your search criteria"
                  : "No VLANs have been configured on the OLT"}
              </p>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">VLAN ID</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Tagged</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredVlans.map((vlan) => (
                    <TableRow key={vlan.id} data-testid={`row-vlan-${vlan.id}`}>
                      <TableCell>
                        <Badge variant="outline" className="font-mono font-medium">
                          {vlan.id}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">{vlan.name}</TableCell>
                      <TableCell className="text-muted-foreground max-w-[200px] truncate">
                        {vlan.description}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={getTypeBadgeClass(vlan.type)}>
                          {vlan.type}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {vlan.tagged ? (
                          <Badge variant="secondary" className="text-xs">Tagged</Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs">Untagged</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {vlan.inUse ? (
                          <Badge variant="outline" className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20">
                            In Use
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20">
                            Available
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
