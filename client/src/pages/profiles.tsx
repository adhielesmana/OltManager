import { useQuery, useMutation } from "@tanstack/react-query";
import type { LineProfile, ServiceProfile } from "@shared/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Layers, GitBranch, Settings2, RefreshCw } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function ProfilesPage() {
  const { toast } = useToast();

  const { data: lineProfiles = [], isLoading: lineLoading } = useQuery<LineProfile[]>({
    queryKey: ["/api/profiles/line"],
  });

  const { data: serviceProfiles = [], isLoading: serviceLoading } = useQuery<ServiceProfile[]>({
    queryKey: ["/api/profiles/service"],
  });

  const reloadMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/profiles/refresh");
      return res.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        toast({ title: "Reload Complete", description: data.message });
        queryClient.invalidateQueries({ queryKey: ["/api/profiles/line"] });
        queryClient.invalidateQueries({ queryKey: ["/api/profiles/service"] });
      } else {
        toast({ title: "Reload Failed", description: data.message, variant: "destructive" });
      }
    },
    onError: (error: Error) => {
      toast({ title: "Reload Error", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Layers className="h-6 w-6 text-muted-foreground" />
            Profiles
          </h1>
          <p className="text-muted-foreground mt-1">
            Line and service profiles for ONU configuration
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => reloadMutation.mutate()}
          disabled={reloadMutation.isPending}
          data-testid="button-refresh-profiles"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${reloadMutation.isPending ? "animate-spin" : ""}`} />
          {reloadMutation.isPending ? "Reloading..." : "Reload from OLT"}
        </Button>
      </div>

      <Tabs defaultValue="line" className="space-y-4">
        <TabsList>
          <TabsTrigger value="line" className="flex items-center gap-2" data-testid="tab-line-profiles">
            <GitBranch className="h-4 w-4" />
            Line Profiles
          </TabsTrigger>
          <TabsTrigger value="service" className="flex items-center gap-2" data-testid="tab-service-profiles">
            <Settings2 className="h-4 w-4" />
            Service Profiles
          </TabsTrigger>
        </TabsList>

        <TabsContent value="line">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Line Profiles</CardTitle>
              <CardDescription>
                Bandwidth and traffic profiles for ONUs ({lineProfiles.length} profiles)
              </CardDescription>
            </CardHeader>
            <CardContent>
              {lineLoading ? (
                <div className="space-y-3">
                  {[...Array(3)].map((_, i) => (
                    <Skeleton key={i} className="h-14 w-full" />
                  ))}
                </div>
              ) : lineProfiles.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted mb-4">
                    <GitBranch className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <h3 className="font-medium text-lg">No line profiles</h3>
                  <p className="text-muted-foreground text-sm mt-1">
                    No line profiles have been configured on the OLT
                  </p>
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-16">ID</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>T-CONT</TableHead>
                        <TableHead>GEM Port</TableHead>
                        <TableHead>Mapping Mode</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lineProfiles.map((profile) => (
                        <TableRow key={profile.id} data-testid={`row-line-profile-${profile.id}`}>
                          <TableCell>
                            <Badge variant="outline" className="font-mono">
                              {profile.id}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-medium">{profile.name}</TableCell>
                          <TableCell className="text-muted-foreground max-w-[200px] truncate">
                            {profile.description}
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="font-mono">
                              {profile.tcont}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="font-mono">
                              {profile.gemportId}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">
                              {profile.mappingMode}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="service">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Service Profiles</CardTitle>
              <CardDescription>
                Port and service configuration profiles ({serviceProfiles.length} profiles)
              </CardDescription>
            </CardHeader>
            <CardContent>
              {serviceLoading ? (
                <div className="space-y-3">
                  {[...Array(3)].map((_, i) => (
                    <Skeleton key={i} className="h-14 w-full" />
                  ))}
                </div>
              ) : serviceProfiles.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted mb-4">
                    <Settings2 className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <h3 className="font-medium text-lg">No service profiles</h3>
                  <p className="text-muted-foreground text-sm mt-1">
                    No service profiles have been configured on the OLT
                  </p>
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-16">ID</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Port Count</TableHead>
                        <TableHead>Port Type</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {serviceProfiles.map((profile) => (
                        <TableRow key={profile.id} data-testid={`row-service-profile-${profile.id}`}>
                          <TableCell>
                            <Badge variant="outline" className="font-mono">
                              {profile.id}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-medium">{profile.name}</TableCell>
                          <TableCell className="text-muted-foreground max-w-[200px] truncate">
                            {profile.description}
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary">{profile.portCount}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">
                              {profile.portType}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
