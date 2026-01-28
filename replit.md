# Huawei OLT Manager

## Overview
A professional network operations management application for Huawei MA5801 OLT devices. This tool helps network operators manage GPON ONUs with safety guardrails to prevent accidental misconfigurations.

## Recent Changes (January 2026)
- **Auto-detect GPON ports**: Automatically detects port count from OLT board info (8 or 16 ports)
- **Database storage for OLT data**: All ONU, profile, and VLAN data now stored in database
- **Auto-sync every 60 minutes**: OLT data automatically refreshed in background
- **Manual sync from OLT**: Added "Sync from OLT" button with 30-second cooldown
- **Last sync time**: Shows when data was last refreshed from OLT
- Added user authentication and authorization system
- Implemented role-based access control (super_admin, admin, user)
- Added user management page for admins
- Added OLT settings page for connection management
- Protected all routes with authentication middleware
- Fixed bound ONU parsing to handle Huawei spaced port format (0/ 1/0 → 0/1/0)
- Improved SSH shell buffer handling for { <cr>||<K> } prompts

## GPON Port Auto-Detection

The app automatically detects available GPON ports from the OLT:

### Detection Method
1. Connects to OLT via SSH
2. Runs `display board 0` command
3. Parses board info to find GPON boards (boards with "GP" in name)
4. Looks up known board types for port count

### Known Board Types
- **8-port boards**: H802GPBD, H802GPFA, H801GPBD, H801GPFA
- **16-port boards**: H802GPFD, H802GPHF, V922GPHF, V921GPHF, etc.
- **Unknown GP boards**: Default to 16 ports

### Fallback Behavior
- Before SSH connects: Shows 16 ports (0/1/0-7 and 0/2/0-7) as default
- After SSH connects: Shows actual detected ports
- Cached until reconnect for fast access

## Data Storage Architecture

### Database-First Approach
OLT data (ONUs, profiles, VLANs) is stored in the PostgreSQL database instead of being fetched from the OLT device on every request. This provides:
- **Fast UI**: Data served instantly from database
- **Reduced OLT load**: No constant SSH queries
- **Data persistence**: Survives server restarts
- **Manual refresh**: User controls when to sync fresh data

### Database Tables for OLT Data
- `unbound_onus` - Discovered but unconfigured ONUs
- `bound_onus` - Configured ONUs with status and optical info
- `line_profiles` - Bandwidth profiles
- `service_profiles` - Port configurations  
- `vlans` - VLAN settings
- `olt_data_refresh` - Tracks last refresh time and status

### Sync Workflow
1. User clicks "Sync from OLT" button
2. App connects to OLT via SSH (if not already connected)
3. Fetches all ONU data, profiles, and VLANs
4. Saves to database (replaces old data for that OLT)
5. Updates last refresh timestamp
6. UI refreshes to show new data

## Authentication System

### Default Super Admin
- **Username**: adhielesmana
- **Password**: admin123!
- **Role**: super_admin (hardcoded, cannot be deleted)

### User Roles
1. **super_admin**: Full access - can manage all users including admins, configure OLT, perform all ONU operations
2. **admin**: Can manage regular users (not admins), configure OLT, perform all ONU operations
3. **user**: Can only perform ONU operations (view, bind, unbind, verify)

### Session Management
- Sessions expire after 24 hours
- Session token stored in localStorage and sent via x-session-id header
- Passwords hashed with bcrypt (12 rounds)

## Core Features

### 1. ONU Discovery (Unbound ONU)
- View all discovered but unconfigured ONUs
- Search by serial number or GPON port
- Shows equipment ID and discovery time
- Quick bind action for each ONU

### 2. ONU Management (Bound ONU)
- View all configured ONUs with status indicators
- Status types: Online, Offline, LOS (fiber issue)
- Optical power monitoring (RX/TX power, distance)
- Search by serial number, port, or description
- Unbind with confirmation and optional config cleanup

### 3. ONU Verification
Answer 3 key questions:
- Is this ONU new/unbound/already used?
- Can I bind it safely?
- Did service come up?

### 4. Safe ONU Binding
- Validation before binding (ONU must be in autofind, not already bound)
- Auto-detect next free ONU ID
- Profile and VLAN validation
- Server-side guardrails prevent:
  - Binding already-bound ONUs
  - Using non-existent profiles
  - Duplicate ONU IDs

### 5. Profiles & VLANs
- View line profiles (bandwidth templates)
- View service profiles (port configurations)
- VLAN management with availability tracking

### 6. User Management (Admin only)
- Add new users with role assignment
- Delete users (with role-based restrictions)
- View all registered users

### 7. OLT Settings (Admin only)
- Configure OLT SSH connection details
- Test connection to OLT device
- View connection status

## Safety Guardrails

### Server-Side Validations
- ONU serial number must be in autofind list
- ONU cannot already be bound
- Line and service profiles must exist
- VLAN must exist (if specified)
- Auto-selection of free ONU ID per GPON port

### UI Guardrails
- Validate button required before binding
- Confirmation checkbox for unbinding
- Warning messages for destructive actions
- Status badges for quick identification

## Project Structure

```
client/src/
├── components/
│   ├── app-sidebar.tsx      # Main navigation sidebar (role-aware)
│   ├── bind-onu-dialog.tsx  # ONU binding with validation
│   ├── unbind-onu-dialog.tsx # ONU removal with confirmation
│   ├── onu-verification-dialog.tsx # Quick ONU lookup
│   ├── onu-status-badge.tsx # Status indicators
│   ├── theme-provider.tsx   # Dark/light mode
│   └── theme-toggle.tsx     # Theme switch button
├── lib/
│   ├── auth.tsx             # Authentication context and hooks
│   └── queryClient.ts       # TanStack Query with session headers
├── pages/
│   ├── login.tsx            # Login page
│   ├── unbound-onu.tsx      # Discovered ONUs
│   ├── bound-onu.tsx        # Configured ONUs
│   ├── profiles.tsx         # Line & Service profiles
│   ├── vlans.tsx            # VLAN management
│   ├── users.tsx            # User management (admin only)
│   └── olt-settings.tsx     # OLT connection settings (admin only)
└── App.tsx                  # Main app with routing and auth

server/
├── auth.ts                  # Authentication utilities (bcrypt, sessions, permissions)
├── db.ts                    # Drizzle ORM database connection
├── routes.ts                # API endpoints with auth middleware
├── storage.ts               # Storage interface (database + in-memory OLT data)
└── index.ts                 # Express server setup

shared/
└── schema.ts                # TypeScript types, Zod schemas, Drizzle tables
```

## API Endpoints

### Authentication
- `POST /api/auth/login` - Login with username/password
- `POST /api/auth/logout` - Logout and invalidate session
- `GET /api/auth/me` - Get current user info

### User Management (Admin only)
- `GET /api/users` - List all users
- `POST /api/users` - Create new user
- `DELETE /api/users/:id` - Delete user (with role checks)

### OLT Credentials (Admin only)
- `GET /api/olt/credentials` - List OLT connections
- `POST /api/olt/credentials` - Add new OLT connection
- `DELETE /api/olt/credentials/:id` - Remove OLT connection
- `POST /api/olt/connect/:id` - Connect to OLT device

### OLT Operations (Protected)
- `GET /api/olt/info` - OLT device information
- `GET /api/onu/unbound` - List unbound ONUs
- `GET /api/onu/unbound/count` - Count of unbound ONUs
- `GET /api/onu/bound` - List bound ONUs
- `GET /api/profiles/line` - Line profiles
- `GET /api/profiles/service` - Service profiles
- `GET /api/vlans` - VLAN configuration
- `GET /api/onu/verify/:sn` - Verify ONU status

### Config Actions (Requires Validation)
- `POST /api/onu/validate` - Validate ONU before binding
- `POST /api/onu/bind` - Bind ONU (with guardrails)
- `POST /api/onu/unbind` - Unbind ONU (with confirmation)

## Technology Stack
- Frontend: React, TanStack Query, Tailwind CSS, shadcn/ui
- Backend: Express.js, Zod validation
- Database: PostgreSQL with Drizzle ORM
- Authentication: bcrypt for password hashing, session-based auth
- Routing: wouter
- State: Database for users/sessions, in-memory for OLT data (fetched via SSH)

## Self-Hosted Deployment

### Quick Deploy
```bash
# Basic deployment
./deploy.sh --domain olt.yourdomain.com --email admin@yourdomain.com

# Skip SSL (for testing)
./deploy.sh --domain olt.yourdomain.com --skip-ssl

# Custom starting port
./deploy.sh --domain olt.yourdomain.com --port 8080

# Force specific port (for multi-container servers)
./deploy.sh --domain olt.yourdomain.com --force-port 3005
```

### Troubleshooting Commands
```bash
# Check deployment state and diagnose issues
./deploy.sh --diagnose

# Auto-fix 502 errors without full redeploy
./deploy.sh --repair
```

### Deployment Features
1. **Auto Port Detection** - Finds next available port if default is in use
2. **Port Persistence** - Saves assigned port to .env.production for reuse
3. **Diagnostics** - Detects port mismatches between nginx and Docker
4. **Auto-Repair** - Fixes corrupted nginx configs automatically
5. **Smart Nginx Setup** - Skips installation if already present, validates configs
6. **Config Validation** - Detects ANSI corruption and recreates if needed
7. **Auto SSL** - Configures Let's Encrypt with auto-renewal (skips if already configured)
8. **Database Backup** - Automatic backup before every deployment (keeps last 7)
9. **Docker Cleanup** - Removes unused containers, images, and cache older than 24h

### Environment Variables
- `DATABASE_URL` - PostgreSQL connection string
- `SESSION_SECRET` - Session encryption secret (auto-generated if not set)
- `DOMAIN` - Domain name (can also use --domain flag)
- `EMAIL` - Email for Let's Encrypt (can also use --email flag)

### Docker Commands
```bash
docker logs -f huawei-olt-manager  # View logs
docker stop huawei-olt-manager     # Stop
docker start huawei-olt-manager    # Start
docker restart huawei-olt-manager  # Restart
```

## User Preferences
- Professional network operations theme
- Dark/light mode support
- Monospace fonts for serial numbers and technical data
- Status color coding (green=online, red=LOS, gray=offline)
