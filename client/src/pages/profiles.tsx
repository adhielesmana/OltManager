import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import type { LineProfile, ServiceProfile } from "@shared/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Layers, GitBranch, Settings2, RefreshCw, Radio, Plus } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface Tr069Profile {
  id: number;
  name: string;
  acsUrl?: string;
  periodicInterval?: number;
}

export default function ProfilesPage() {
  const { toast } = useToast();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newProfile, setNewProfile] = useState({
    name: "",
    acsUrl: "",
    username: "",
    password: "",
    periodicInterval: "",
  });

  const { data: lineProfiles = [], isLoading: lineLoading } = useQuery<LineProfile[]>({
    queryKey: ["/api/profiles/line"],
  });

  const { data: serviceProfiles = [], isLoading: serviceLoading } = useQuery<ServiceProfile[]>({
    queryKey: ["/api/profiles/service"],
  });

  const { data: tr069Profiles = [], isLoading: tr069Loading } = useQuery<Tr069Profile[]>({
    queryKey: ["/api/tr069-profiles"],
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

  const reloadTr069Mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/tr069-profiles/refresh");
      return res.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        toast({ title: "TR-069 Reload Complete", description: data.message });
        queryClient.invalidateQueries({ queryKey: ["/api/tr069-profiles"] });
      } else {
        toast({ title: "TR-069 Reload Failed", description: data.message, variant: "destructive" });
      }
    },
    onError: (error: Error) => {
      toast({ title: "TR-069 Reload Error", description: error.message, variant: "destructive" });
    },
  });

  const createTr069Mutation = useMutation({
    mutationFn: async (data: typeof newProfile) => {
      const res = await apiRequest("POST", "/api/tr069-profiles", data);
      return res.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        toast({ title: "Profile Created", description: data.message });
        queryClient.invalidateQueries({ queryKey: ["/api/tr069-profiles"] });
        setCreateDialogOpen(false);
        setNewProfile({ name: "", acsUrl: "", username: "", password: "", periodicInterval: "" });
      } else {
        toast({ title: "Create Failed", description: data.message, variant: "destructive" });
      }
    },
    onError: (error: Error) => {
      toast({ title: "Create Error", description: error.message, variant: "destructive" });
    },
  });

  const handleCreateProfile = () => {
    if (!newProfile.name || !newProfile.acsUrl) {
      toast({ title: "Missing Fields", description: "Profile name and ACS URL are required", variant: "destructive" });
      return;
    }
    createTr069Mutation.mutate(newProfile);
  };

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
          <TabsTrigger value="tr069" className="flex items-center gap-2" data-testid="tab-tr069-profiles">
            <Radio className="h-4 w-4" />
            TR-069 ACS
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

        <TabsContent value="tr069">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <div>
                <CardTitle className="text-base">TR-069 ACS Profiles</CardTitle>
                <CardDescription>
                  Auto-configuration server profiles for remote management ({tr069Profiles.length} profiles)
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => setCreateDialogOpen(true)}
                  data-testid="button-create-tr069"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Create
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => reloadTr069Mutation.mutate()}
                  disabled={reloadTr069Mutation.isPending}
                  data-testid="button-refresh-tr069"
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${reloadTr069Mutation.isPending ? "animate-spin" : ""}`} />
                  {reloadTr069Mutation.isPending ? "Reloading..." : "Reload"}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {tr069Loading ? (
                <div className="space-y-3">
                  {[...Array(3)].map((_, i) => (
                    <Skeleton key={i} className="h-14 w-full" />
                  ))}
                </div>
              ) : tr069Profiles.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted mb-4">
                    <Radio className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <h3 className="font-medium text-lg">No TR-069 profiles</h3>
                  <p className="text-muted-foreground text-sm mt-1 mb-4">
                    No TR-069 ACS profiles found. Create one or reload from OLT.
                  </p>
                  <Button
                    onClick={() => setCreateDialogOpen(true)}
                    data-testid="button-create-tr069-empty"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Create ACS Profile
                  </Button>
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-16">ID</TableHead>
                        <TableHead>Profile Name</TableHead>
                        <TableHead>ACS URL</TableHead>
                        <TableHead>Periodic Interval</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tr069Profiles.map((profile) => (
                        <TableRow key={profile.id} data-testid={`row-tr069-profile-${profile.id}`}>
                          <TableCell>
                            <Badge variant="outline" className="font-mono">
                              {profile.id}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-medium">{profile.name}</TableCell>
                          <TableCell className="text-muted-foreground font-mono text-xs max-w-[300px] truncate">
                            {profile.acsUrl || "-"}
                          </TableCell>
                          <TableCell>
                            {profile.periodicInterval ? (
                              <Badge variant="secondary">{profile.periodicInterval}s</Badge>
                            ) : (
                              <span className="text-muted-foreground">-</span>
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
        </TabsContent>
      </Tabs>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create TR-069 ACS Profile</DialogTitle>
            <DialogDescription>
              Create a new TR-069 auto-configuration server profile on the OLT
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="profile-name">Profile Name *</Label>
              <Input
                id="profile-name"
                placeholder="e.g., MY_ACS_SERVER"
                value={newProfile.name}
                onChange={(e) => setNewProfile({ ...newProfile, name: e.target.value })}
                data-testid="input-tr069-name"
              />
              <p className="text-xs text-muted-foreground">
                Alphanumeric characters and underscores only
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="acs-url">ACS URL *</Label>
              <Input
                id="acs-url"
                placeholder="http://acs.example.com:7547/acs"
                value={newProfile.acsUrl}
                onChange={(e) => setNewProfile({ ...newProfile, acsUrl: e.target.value })}
                data-testid="input-tr069-url"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="acs-username">Username (Optional)</Label>
                <Input
                  id="acs-username"
                  placeholder="admin"
                  value={newProfile.username}
                  onChange={(e) => setNewProfile({ ...newProfile, username: e.target.value })}
                  data-testid="input-tr069-username"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="acs-password">Password (Optional)</Label>
                <Input
                  id="acs-password"
                  type="password"
                  placeholder="••••••"
                  value={newProfile.password}
                  onChange={(e) => setNewProfile({ ...newProfile, password: e.target.value })}
                  data-testid="input-tr069-password"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="periodic-interval">Periodic Interval (Optional)</Label>
              <Input
                id="periodic-interval"
                type="number"
                placeholder="86400 (seconds)"
                value={newProfile.periodicInterval}
                onChange={(e) => setNewProfile({ ...newProfile, periodicInterval: e.target.value })}
                data-testid="input-tr069-interval"
              />
              <p className="text-xs text-muted-foreground">
                Interval in seconds for periodic inform (default: 86400 = 1 day)
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateDialogOpen(false)}
              data-testid="button-cancel-tr069"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateProfile}
              disabled={createTr069Mutation.isPending}
              data-testid="button-submit-tr069"
            >
              {createTr069Mutation.isPending ? "Creating..." : "Create Profile"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
