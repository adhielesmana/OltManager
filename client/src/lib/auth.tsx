import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { apiRequest } from "./queryClient";

interface User {
  id: number;
  username: string;
  role: "super_admin" | "admin" | "user";
  email?: string | null;
}

interface AuthContextType {
  user: User | null;
  sessionId: string | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hasPermission: (action: string) => boolean;
  canManageUsers: boolean;
  canConfigureOlt: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

const PERMISSIONS: Record<string, ("super_admin" | "admin" | "user")[]> = {
  "user:create": ["super_admin", "admin"],
  "user:delete": ["super_admin", "admin"],
  "user:view": ["super_admin", "admin"],
  "olt:configure": ["super_admin", "admin"],
  "olt:view": ["super_admin", "admin", "user"],
  "onu:bind": ["super_admin", "admin", "user"],
  "onu:unbind": ["super_admin", "admin", "user"],
  "onu:view": ["super_admin", "admin", "user"],
  "profiles:view": ["super_admin", "admin", "user"],
  "vlans:view": ["super_admin", "admin", "user"],
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(() => {
    return localStorage.getItem("sessionId");
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const checkSession = async () => {
      const storedSessionId = localStorage.getItem("sessionId");
      if (!storedSessionId) {
        setIsLoading(false);
        return;
      }

      try {
        const response = await fetch("/api/auth/me", {
          headers: { "x-session-id": storedSessionId },
        });
        
        if (response.ok) {
          const userData = await response.json();
          setUser(userData);
          setSessionId(storedSessionId);
        } else {
          localStorage.removeItem("sessionId");
          setSessionId(null);
        }
      } catch {
        localStorage.removeItem("sessionId");
        setSessionId(null);
      }
      
      setIsLoading(false);
    };

    checkSession();
  }, []);

  const login = async (username: string, password: string) => {
    const response = await apiRequest("POST", "/api/auth/login", { username, password });
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || "Login failed");
    }
    
    localStorage.setItem("sessionId", data.sessionId);
    setSessionId(data.sessionId);
    setUser(data.user);
  };

  const logout = async () => {
    if (sessionId) {
      try {
        await fetch("/api/auth/logout", {
          method: "POST",
          headers: { "x-session-id": sessionId },
        });
      } catch {
        // Ignore errors on logout
      }
    }
    
    localStorage.removeItem("sessionId");
    setSessionId(null);
    setUser(null);
  };

  const hasPermission = (action: string) => {
    if (!user) return false;
    return PERMISSIONS[action]?.includes(user.role) ?? false;
  };

  const canManageUsers = user?.role === "super_admin" || user?.role === "admin";
  const canConfigureOlt = user?.role === "super_admin" || user?.role === "admin";

  return (
    <AuthContext.Provider
      value={{
        user,
        sessionId,
        isLoading,
        login,
        logout,
        hasPermission,
        canManageUsers,
        canConfigureOlt,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

// Custom fetch wrapper that includes session ID
export function useAuthenticatedFetch() {
  const { sessionId } = useAuth();
  
  return async (url: string, options: RequestInit = {}) => {
    const headers = new Headers(options.headers);
    if (sessionId) {
      headers.set("x-session-id", sessionId);
    }
    
    return fetch(url, { ...options, headers });
  };
}
