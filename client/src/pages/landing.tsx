import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";
import { 
  Network, 
  Shield, 
  Zap, 
  Activity, 
  Users, 
  Server,
  ChevronRight,
  Check,
  Wifi,
  Eye,
  Settings,
  BarChart3
} from "lucide-react";
import huaweiLogo from "@/assets/huawei-logo.png";

const features = [
  {
    icon: Network,
    title: "ONU Discovery",
    description: "Automatically detect and manage unbound ONUs across your GPON network with real-time discovery."
  },
  {
    icon: Zap,
    title: "Quick Binding",
    description: "Streamlined ONU binding with smart validation, profile selection, and automatic WiFi configuration."
  },
  {
    icon: Activity,
    title: "Optical Monitoring",
    description: "Real-time optical power monitoring with RX/TX levels, distance calculation, and health indicators."
  },
  {
    icon: Shield,
    title: "Safety Guardrails",
    description: "Built-in validation prevents accidental misconfigurations with server-side checks and confirmations."
  },
  {
    icon: Users,
    title: "Role-Based Access",
    description: "Three-tier permission system with super admin, admin, and user roles for secure team access."
  },
  {
    icon: Server,
    title: "Multi-OLT Support",
    description: "Manage multiple OLT devices from a single interface with automatic connection handling."
  }
];

const capabilities = [
  "Automatic GPON port detection (8/16 ports)",
  "Huawei OMCI binding with auto WiFi",
  "General ONU support for third-party devices",
  "Line & service profile management",
  "VLAN configuration and tracking",
  "ONU verification and status checks",
  "Automatic data sync every 60 minutes",
  "SSH connection management"
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={huaweiLogo} alt="Huawei" className="h-8 w-auto" />
            <span className="font-semibold text-lg">OLT Manager</span>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Link href="/login">
              <Button data-testid="button-nav-login">
                Sign In
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/10" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-blue-500/10 via-transparent to-transparent" />
        
        <div className="container mx-auto px-4 py-20 md:py-32 relative">
          <div className="max-w-4xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6">
              <Wifi className="h-4 w-4" />
              Professional GPON Network Management
            </div>
            
            <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">
              Manage Your
              <span className="bg-gradient-to-r from-primary to-blue-600 bg-clip-text text-transparent"> Huawei MA5801 </span>
              OLT with Confidence
            </h1>
            
            <p className="text-lg md:text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
              A modern, intuitive interface for GPON network operations. Discover, bind, and monitor ONUs with built-in safety guardrails to prevent misconfigurations.
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/login">
                <Button size="lg" className="w-full sm:w-auto text-base px-8" data-testid="button-hero-login">
                  Get Started
                  <ChevronRight className="ml-2 h-5 w-5" />
                </Button>
              </Link>
              <Button size="lg" variant="outline" className="w-full sm:w-auto text-base px-8" asChild>
                <a href="#features">
                  <Eye className="mr-2 h-5 w-5" />
                  View Features
                </a>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="border-y bg-muted/30">
        <div className="container mx-auto px-4 py-12">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            <div className="text-center">
              <div className="text-3xl md:text-4xl font-bold text-primary mb-1">MA5801</div>
              <div className="text-sm text-muted-foreground">Series Support</div>
            </div>
            <div className="text-center">
              <div className="text-3xl md:text-4xl font-bold text-primary mb-1">16</div>
              <div className="text-sm text-muted-foreground">GPON Ports</div>
            </div>
            <div className="text-center">
              <div className="text-3xl md:text-4xl font-bold text-primary mb-1">60min</div>
              <div className="text-sm text-muted-foreground">Auto Sync</div>
            </div>
            <div className="text-center">
              <div className="text-3xl md:text-4xl font-bold text-primary mb-1">3</div>
              <div className="text-sm text-muted-foreground">User Roles</div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section id="features" className="container mx-auto px-4 py-20">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Everything You Need for OLT Management
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Comprehensive tools designed for network operators who demand reliability and efficiency.
          </p>
        </div>
        
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, index) => (
            <Card key={index} className="group hover-elevate transition-all duration-300 border-2 hover:border-primary/20">
              <CardContent className="p-6">
                <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                  <feature.icon className="h-6 w-6 text-primary" />
                </div>
                <h3 className="text-xl font-semibold mb-2">{feature.title}</h3>
                <p className="text-muted-foreground">{feature.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Capabilities Section */}
      <section className="bg-muted/30 border-y">
        <div className="container mx-auto px-4 py-20">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl md:text-4xl font-bold mb-4">
                Built for Network Professionals
              </h2>
              <p className="text-lg text-muted-foreground mb-8">
                Every feature is designed with real-world network operations in mind, from automatic port detection to intelligent SSH connection handling.
              </p>
              
              <div className="grid sm:grid-cols-2 gap-3">
                {capabilities.map((capability, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <div className="h-5 w-5 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
                      <Check className="h-3 w-3 text-green-600" />
                    </div>
                    <span className="text-sm">{capability}</span>
                  </div>
                ))}
              </div>
            </div>
            
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-blue-500/20 rounded-2xl blur-3xl" />
              <Card className="relative border-2">
                <CardContent className="p-6">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-3 rounded-lg bg-muted">
                      <div className="flex items-center gap-3">
                        <div className="h-3 w-3 rounded-full bg-green-500" />
                        <span className="font-mono text-sm">ONU-4857393AB</span>
                      </div>
                      <span className="text-xs text-green-600 font-medium">Online</span>
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-lg bg-muted">
                      <div className="flex items-center gap-3">
                        <div className="h-3 w-3 rounded-full bg-green-500" />
                        <span className="font-mono text-sm">ONU-7263847BC</span>
                      </div>
                      <span className="text-xs text-green-600 font-medium">Online</span>
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-lg bg-muted">
                      <div className="flex items-center gap-3">
                        <div className="h-3 w-3 rounded-full bg-orange-500" />
                        <span className="font-mono text-sm">ONU-9182736CD</span>
                      </div>
                      <span className="text-xs text-orange-600 font-medium">LOS</span>
                    </div>
                    <div className="grid grid-cols-3 gap-3 pt-2">
                      <div className="text-center p-2 rounded bg-muted">
                        <BarChart3 className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
                        <div className="text-xs text-muted-foreground">RX: -18.2dBm</div>
                      </div>
                      <div className="text-center p-2 rounded bg-muted">
                        <Activity className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
                        <div className="text-xs text-muted-foreground">TX: 2.4dBm</div>
                      </div>
                      <div className="text-center p-2 rounded bg-muted">
                        <Settings className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
                        <div className="text-xs text-muted-foreground">1.2km</div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="container mx-auto px-4 py-20">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Ready to Streamline Your Network Operations?
          </h2>
          <p className="text-lg text-muted-foreground mb-8">
            Sign in to start managing your Huawei MA5801 OLT with confidence.
          </p>
          <Link href="/login">
            <Button size="lg" className="text-base px-8" data-testid="button-cta-login">
              Sign In Now
              <ChevronRight className="ml-2 h-5 w-5" />
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t bg-muted/30">
        <div className="container mx-auto px-4 py-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <img src={huaweiLogo} alt="Huawei" className="h-6 w-auto opacity-60" />
              <span className="text-sm text-muted-foreground">OLT Manager for MA5801 Series</span>
            </div>
            <div className="text-sm text-muted-foreground">
              Professional GPON Network Management Tool
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
