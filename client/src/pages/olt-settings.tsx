import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Trash2, Server, Wifi, WifiOff, Settings, Play, Pencil } from "lucide-react";

interface OltCredential {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  protocol: string;
  isActive: boolean;
  isConnected: boolean;
  lastConnected: string | null;
}

export default function OltSettingsPage() {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [protocol, setProtocol] = useState("ssh");

  const { data: credentials, isLoading } = useQuery<OltCredential[]>({
    queryKey: ["/api/olt/credentials"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; host: string; port: number; username: string; password: string; protocol: string }) => {
      const response = await apiRequest("POST", "/api/olt/credentials", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/olt/credentials"] });
      setIsDialogOpen(false);
      resetForm();
      toast({ title: "OLT credential saved successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save OLT credential", description: error.message, variant: "destructive" });
    },
  });

  const connectMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest("POST", `/api/olt/connect/${id}`);
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/olt/credentials"] });
      queryClient.invalidateQueries({ queryKey: ["/api/olt/info"] });
      if (data.success) {
        toast({ title: "Connected to OLT", description: data.message });
      } else {
        toast({ title: "Connection failed", description: data.message, variant: "destructive" });
      }
    },
    onError: (error: Error) => {
      toast({ title: "Failed to connect to OLT", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/olt/credentials/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/olt/credentials"] });
      toast({ title: "OLT credential deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete credential", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { id: number; name: string; host: string; port: number; username: string; password?: string; protocol: string }) => {
      const { id, ...updates } = data;
      const response = await apiRequest("PATCH", `/api/olt/credentials/${id}`, updates);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/olt/credentials"] });
      setIsEditDialogOpen(false);
      setEditingId(null);
      resetForm();
      toast({ title: "OLT credential updated successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update OLT credential", description: error.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setName("");
    setHost("");
    setPort("22");
    setUsername("");
    setPassword("");
    setProtocol("ssh");
  };

  const handleCreate = () => {
    createMutation.mutate({
      name,
      host,
      port: parseInt(port),
      username,
      password,
      protocol,
    });
  };

  const handleEdit = (cred: OltCredential) => {
    setEditingId(cred.id);
    setName(cred.name);
    setHost(cred.host);
    setPort(String(cred.port));
    setUsername(cred.username);
    setPassword("");
    setProtocol(cred.protocol);
    setIsEditDialogOpen(true);
  };

  const handleUpdate = () => {
    if (!editingId) return;
    const data: any = {
      id: editingId,
      name,
      host,
      port: parseInt(port),
      username,
      protocol,
    };
    if (password) {
      data.password = password;
    }
    updateMutation.mutate(data);
  };

  const activeCredential = credentials?.find(c => c.isActive);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Settings className="h-6 w-6" />
            OLT Settings
          </h1>
          <p className="text-muted-foreground">Configure OLT connection credentials</p>
        </div>
        
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-olt">
              <Plus className="mr-2 h-4 w-4" />
              Add OLT
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Add OLT Connection</DialogTitle>
              <DialogDescription>
                Configure SSH connection to your Huawei OLT device.
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="olt-name">Connection Name</Label>
                <Input
                  id="olt-name"
                  data-testid="input-olt-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Main OLT - Site A"
                />
              </div>
              
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2 space-y-2">
                  <Label htmlFor="olt-host">Host / IP Address</Label>
                  <Input
                    id="olt-host"
                    data-testid="input-olt-host"
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    placeholder="192.168.1.1"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="olt-port">Port</Label>
                  <Input
                    id="olt-port"
                    data-testid="input-olt-port"
                    type="number"
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                    placeholder="22"
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="olt-protocol">Protocol</Label>
                <Select value={protocol} onValueChange={setProtocol}>
                  <SelectTrigger data-testid="select-olt-protocol">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ssh">SSH</SelectItem>
                    <SelectItem value="telnet">Telnet</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="olt-username">Username</Label>
                <Input
                  id="olt-username"
                  data-testid="input-olt-username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="olt-password">Password</Label>
                <Input
                  id="olt-password"
                  data-testid="input-olt-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                />
              </div>
            </div>
            
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                Cancel
              </Button>
              <Button 
                onClick={handleCreate} 
                disabled={createMutation.isPending || !name || !host || !username || !password}
                data-testid="button-save-olt"
              >
                {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save & Connect
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {activeCredential && (
        <Card className={activeCredential.isConnected ? "border-green-500" : "border-orange-500"}>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <div className="flex items-center gap-2">
              <Server className="h-5 w-5" />
              <CardTitle>Active Connection</CardTitle>
            </div>
            <Badge variant={activeCredential.isConnected ? "default" : "secondary"} className={activeCredential.isConnected ? "bg-green-500" : ""}>
              {activeCredential.isConnected ? (
                <><Wifi className="mr-1 h-3 w-3" /> Connected</>
              ) : (
                <><WifiOff className="mr-1 h-3 w-3" /> Disconnected</>
              )}
            </Badge>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Name</p>
                <p className="font-medium">{activeCredential.name}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Host</p>
                <p className="font-mono">{activeCredential.host}:{activeCredential.port}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Protocol</p>
                <p className="uppercase">{activeCredential.protocol}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Last Connected</p>
                <p>{activeCredential.lastConnected ? new Date(activeCredential.lastConnected).toLocaleString() : "Never"}</p>
              </div>
            </div>
            {!activeCredential.isConnected && (
              <Button 
                className="mt-4" 
                onClick={() => connectMutation.mutate(activeCredential.id)}
                disabled={connectMutation.isPending}
                data-testid="button-connect-olt"
              >
                {connectMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Play className="mr-2 h-4 w-4" />
                )}
                Connect
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {!activeCredential && !isLoading && (
        <Alert>
          <Server className="h-4 w-4" />
          <AlertDescription>
            No OLT configured. Add an OLT connection to start managing your GPON network.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>OLT Connections</CardTitle>
          <CardDescription>
            All configured OLT devices
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : credentials && credentials.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Host</TableHead>
                  <TableHead>Protocol</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[150px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {credentials.map((cred) => (
                  <TableRow key={cred.id} data-testid={`row-olt-${cred.id}`}>
                    <TableCell className="font-medium">
                      {cred.name}
                      {cred.isActive && <Badge variant="outline" className="ml-2">Active</Badge>}
                    </TableCell>
                    <TableCell className="font-mono">{cred.host}:{cred.port}</TableCell>
                    <TableCell className="uppercase">{cred.protocol}</TableCell>
                    <TableCell>
                      {cred.isConnected ? (
                        <Badge className="bg-green-500">Connected</Badge>
                      ) : (
                        <Badge variant="secondary">Disconnected</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => connectMutation.mutate(cred.id)}
                          disabled={connectMutation.isPending}
                          data-testid={`button-connect-olt-${cred.id}`}
                        >
                          <Play className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(cred)}
                          data-testid={`button-edit-olt-${cred.id}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteMutation.mutate(cred.id)}
                          disabled={deleteMutation.isPending}
                          data-testid={`button-delete-olt-${cred.id}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No OLT connections configured yet.
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isEditDialogOpen} onOpenChange={(open) => {
        setIsEditDialogOpen(open);
        if (!open) {
          setEditingId(null);
          resetForm();
        }
      }}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Edit OLT Connection</DialogTitle>
            <DialogDescription>
              Update the OLT connection settings. Leave password blank to keep unchanged.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-olt-name">Connection Name</Label>
              <Input
                id="edit-olt-name"
                data-testid="input-edit-olt-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Main OLT - Site A"
              />
            </div>
            
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2 space-y-2">
                <Label htmlFor="edit-olt-host">Host / IP Address</Label>
                <Input
                  id="edit-olt-host"
                  data-testid="input-edit-olt-host"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="192.168.1.1"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-olt-port">Port</Label>
                <Input
                  id="edit-olt-port"
                  data-testid="input-edit-olt-port"
                  type="number"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  placeholder="22"
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="edit-olt-protocol">Protocol</Label>
              <Select value={protocol} onValueChange={setProtocol}>
                <SelectTrigger data-testid="select-edit-olt-protocol">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ssh">SSH</SelectItem>
                  <SelectItem value="telnet">Telnet</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="edit-olt-username">Username</Label>
              <Input
                id="edit-olt-username"
                data-testid="input-edit-olt-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="edit-olt-password">Password</Label>
              <Input
                id="edit-olt-password"
                data-testid="input-edit-olt-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Leave blank to keep unchanged"
              />
              <p className="text-xs text-muted-foreground">Leave blank to keep the current password</p>
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleUpdate} 
              disabled={updateMutation.isPending || !name || !host || !username}
              data-testid="button-update-olt"
            >
              {updateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Update
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
