import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";
import { Input } from "@/components/ui/input";
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
  BarChart3,
  Star
} from "lucide-react";
import huaweiLogo from "@/assets/huawei-logo.png";
import dashboardMockup from "@/assets/dashboard-mockup.png";
import dashboardWidget from "@/assets/dashboard-widget-chart.png";
import chatWidget from "@/assets/dashboard-chat-widget.png";
import insightsBadge from "@/assets/dashboard-insights-badge.png";

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
          <div className="hidden md:flex items-center gap-6">
            <a href="#features" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Features</a>
            <a href="#capabilities" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Capabilities</a>
            <a href="#demo" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Demo</a>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Link href="/login">
              <Button variant="outline" className="hidden sm:inline-flex" data-testid="button-nav-signin">
                Sign In
              </Button>
            </Link>
            <Link href="/login">
              <Button data-testid="button-nav-trial">
                Free Trial
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section - Dark Gradient Like Hubstaff */}
      <section className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 dark:from-slate-950 dark:via-blue-950 dark:to-slate-950">
        {/* Background decorations */}
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden">
          <div className="absolute top-20 left-10 w-72 h-72 bg-blue-500/10 rounded-full blur-3xl" />
          <div className="absolute bottom-20 right-20 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl" />
          <div className="absolute top-1/2 left-1/3 w-64 h-64 bg-cyan-500/5 rounded-full blur-3xl" />
        </div>
        
        <div className="container mx-auto px-4 py-16 md:py-24 relative">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            {/* Left Side - Text Content */}
            <div className="text-white">
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight mb-6 leading-tight">
                Streamline network
                <br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-400">
                  operations for ISP
                </span>
                <br />
                teams everywhere
              </h1>
              
              <p className="text-lg md:text-xl text-gray-300 mb-8 max-w-lg">
                One platform to manage ONU discovery, binding, optical monitoring, and GPON network configuration.
              </p>
              
              {/* Email Signup Form */}
              <div className="flex flex-col sm:flex-row gap-3 max-w-md mb-6">
                <Input 
                  type="email" 
                  placeholder="Enter your work email"
                  className="bg-white/10 border-white/20 text-white placeholder:text-gray-400 h-12"
                  data-testid="input-hero-email"
                />
                <Link href="/login">
                  <Button size="lg" className="h-12 px-6 bg-amber-500 hover:bg-amber-600 text-black font-semibold whitespace-nowrap" data-testid="button-hero-create">
                    Get Started
                  </Button>
                </Link>
              </div>
              
              <p className="text-sm text-gray-400 mb-10">
                No credit card required
              </p>
              
              {/* Trust Badges */}
              <div className="flex flex-wrap items-center gap-6">
                <div className="flex items-center gap-2 bg-white/10 rounded-lg px-4 py-2">
                  <Star className="h-4 w-4 text-amber-400 fill-amber-400" />
                  <span className="text-sm text-white font-medium">4.9</span>
                  <span className="text-xs text-gray-400">Rating</span>
                </div>
                <div className="flex items-center gap-2 bg-white/10 rounded-lg px-4 py-2">
                  <Network className="h-4 w-4 text-blue-400" />
                  <span className="text-sm text-white font-medium">MA5801</span>
                  <span className="text-xs text-gray-400">Certified</span>
                </div>
                <div className="flex items-center gap-2 bg-white/10 rounded-lg px-4 py-2">
                  <Shield className="h-4 w-4 text-green-400" />
                  <span className="text-sm text-white font-medium">Secure</span>
                  <span className="text-xs text-gray-400">SSH</span>
                </div>
                <div className="flex items-center gap-2 bg-white/10 rounded-lg px-4 py-2">
                  <Users className="h-4 w-4 text-purple-400" />
                  <span className="text-sm text-white font-medium">RBAC</span>
                  <span className="text-xs text-gray-400">Roles</span>
                </div>
              </div>
            </div>
            
            {/* Right Side - Dashboard Mockups */}
            <div className="relative hidden lg:block">
              {/* Main Dashboard */}
              <div className="relative z-10">
                <div className="bg-white rounded-xl shadow-2xl overflow-hidden border border-white/20">
                  <div className="bg-gray-100 px-4 py-2 flex items-center gap-2">
                    <div className="flex gap-1.5">
                      <div className="w-3 h-3 rounded-full bg-red-400" />
                      <div className="w-3 h-3 rounded-full bg-yellow-400" />
                      <div className="w-3 h-3 rounded-full bg-green-400" />
                    </div>
                    <div className="flex-1 flex justify-center">
                      <div className="bg-white rounded px-3 py-0.5 text-xs text-gray-500">
                        olt-manager.app/dashboard
                      </div>
                    </div>
                  </div>
                  <img 
                    src={dashboardMockup} 
                    alt="OLT Manager Dashboard" 
                    className="w-full"
                  />
                </div>
              </div>
              
              {/* Floating Widget - Top Right */}
              <div className="absolute -top-4 -right-4 z-20 animate-float">
                <div className="bg-white rounded-lg shadow-xl p-2 border">
                  <div className="text-xs text-blue-600 font-medium px-2 py-1 bg-blue-50 rounded-full text-center">
                    Actionable Insights
                  </div>
                </div>
              </div>
              
              {/* Floating Chart Widget - Left */}
              <div className="absolute top-1/3 -left-8 z-20 animate-float-delayed">
                <div className="bg-white rounded-xl shadow-xl overflow-hidden w-40">
                  <img 
                    src={dashboardWidget} 
                    alt="Analytics Widget" 
                    className="w-full"
                  />
                </div>
              </div>
              
              {/* Floating Chat Widget - Bottom Right */}
              <div className="absolute -bottom-4 right-8 z-20 animate-float">
                <div className="bg-white rounded-xl shadow-xl overflow-hidden w-48">
                  <img 
                    src={chatWidget} 
                    alt="Support Chat" 
                    className="w-full"
                  />
                </div>
              </div>
              
              {/* Status Badge - Top Left */}
              <div className="absolute top-1/4 left-4 z-20 animate-float-delayed">
                <div className="bg-green-100 text-green-700 text-xs font-medium px-3 py-1.5 rounded-full shadow-lg flex items-center gap-2">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                  Increase trust & visibility
                </div>
              </div>
            </div>
          </div>
        </div>
        
        {/* Wave Separator */}
        <div className="absolute bottom-0 left-0 right-0">
          <svg viewBox="0 0 1440 120" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full">
            <path d="M0 120L60 105C120 90 240 60 360 45C480 30 600 30 720 37.5C840 45 960 60 1080 67.5C1200 75 1320 75 1380 75L1440 75V120H1380C1320 120 1200 120 1080 120C960 120 840 120 720 120C600 120 480 120 360 120C240 120 120 120 60 120H0Z" className="fill-background"/>
          </svg>
        </div>
      </section>

      {/* Stats Section */}
      <section className="border-b bg-background">
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
      <section id="capabilities" className="bg-muted/30 border-y">
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
            
            <div id="demo" className="relative">
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

      {/* Animation Styles */}
      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-10px); }
        }
        @keyframes float-delayed {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-8px); }
        }
        .animate-float {
          animation: float 4s ease-in-out infinite;
        }
        .animate-float-delayed {
          animation: float-delayed 5s ease-in-out infinite;
          animation-delay: 1s;
        }
      `}</style>
    </div>
  );
}
