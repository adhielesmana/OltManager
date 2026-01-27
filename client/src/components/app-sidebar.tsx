import { Link, useLocation } from "wouter";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
} from "@/components/ui/sidebar";
import {
  Radio,
  Link2,
  Link2Off,
  Settings,
  Layers,
  Network,
  Shield,
  Activity,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import type { OltInfo } from "@shared/schema";

const discoveryItems = [
  {
    title: "Unbound ONU",
    url: "/unbound",
    icon: Link2Off,
    description: "Discovered but not configured",
  },
  {
    title: "Bound ONU",
    url: "/bound",
    icon: Link2,
    description: "Configured and active",
  },
];

const configItems = [
  {
    title: "Profiles",
    url: "/profiles",
    icon: Layers,
    description: "Line & Service Profiles",
  },
  {
    title: "VLANs",
    url: "/vlans",
    icon: Network,
    description: "Available VLANs",
  },
];

export function AppSidebar() {
  const [location] = useLocation();

  const { data: oltInfo } = useQuery<OltInfo>({
    queryKey: ["/api/olt/info"],
  });

  const { data: unboundCount } = useQuery<{ count: number }>({
    queryKey: ["/api/onu/unbound/count"],
    refetchInterval: 5000,
  });

  return (
    <Sidebar>
      <SidebarHeader className="p-4 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Radio className="h-5 w-5" />
          </div>
          <div className="flex flex-col">
            <span className="font-semibold text-sm">Huawei OLT Manager</span>
            <span className="text-xs text-muted-foreground">MA5801 Series</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent className="p-2">
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs font-medium text-muted-foreground px-2 mb-1">
            Discovery
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {discoveryItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={location === item.url || (item.url === "/unbound" && location === "/")}
                  >
                    <Link href={item.url === "/unbound" ? "/" : item.url} data-testid={`link-${item.title.toLowerCase().replace(/\s+/g, "-")}`}>
                      <item.icon className="h-4 w-4" />
                      <span className="flex-1">{item.title}</span>
                      {item.title === "Unbound ONU" && unboundCount && unboundCount.count > 0 && (
                        <Badge variant="default" className="h-5 min-w-5 text-xs px-1.5">
                          {unboundCount.count}
                        </Badge>
                      )}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="mt-4">
          <SidebarGroupLabel className="text-xs font-medium text-muted-foreground px-2 mb-1">
            Configuration
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {configItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={location === item.url}>
                    <Link href={item.url} data-testid={`link-${item.title.toLowerCase().replace(/\s+/g, "-")}`}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs">
            <Activity className="h-3.5 w-3.5 text-green-500 status-pulse" />
            <span className="text-muted-foreground">OLT Connected</span>
          </div>
          {oltInfo && (
            <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
              <span className="font-mono">{oltInfo.product}</span>
              <span className="font-mono text-[10px]">v{oltInfo.version}</span>
            </div>
          )}
          <div className="flex items-center gap-1.5 mt-1">
            <Shield className="h-3 w-3 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
              Provisioner Mode
            </span>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
