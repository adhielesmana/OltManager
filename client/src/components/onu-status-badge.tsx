import { Badge } from "@/components/ui/badge";
import type { OnuStatus, OnuConfigState } from "@shared/schema";
import { Circle, AlertTriangle, WifiOff, CheckCircle2 } from "lucide-react";

interface OnuStatusBadgeProps {
  status: OnuStatus;
  showLabel?: boolean;
}

export function OnuStatusBadge({ status, showLabel = true }: OnuStatusBadgeProps) {
  const config = {
    online: {
      icon: CheckCircle2,
      label: "Online",
      className: "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20",
    },
    offline: {
      icon: Circle,
      label: "Offline",
      className: "bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20",
    },
    los: {
      icon: WifiOff,
      label: "LOS",
      className: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
    },
    "auth-fail": {
      icon: AlertTriangle,
      label: "Auth Fail",
      className: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
    },
  };

  const { icon: Icon, label, className } = config[status];

  return (
    <Badge variant="outline" className={`gap-1.5 font-medium ${className}`}>
      <Icon className={`h-3 w-3 ${status === "online" ? "status-pulse" : ""}`} />
      {showLabel && <span>{label}</span>}
    </Badge>
  );
}

interface ConfigStateBadgeProps {
  state: OnuConfigState;
}

export function ConfigStateBadge({ state }: ConfigStateBadgeProps) {
  const config = {
    normal: {
      label: "Normal",
      className: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
    },
    failed: {
      label: "Failed",
      className: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
    },
    initial: {
      label: "Initial",
      className: "bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20",
    },
  };

  const { label, className } = config[state];

  return (
    <Badge variant="outline" className={`font-medium ${className}`}>
      {label}
    </Badge>
  );
}
