# Huawei OLT Manager

## Overview
A professional network operations management application for Huawei MA5801 OLT devices. This tool helps network operators manage GPON ONUs with safety guardrails to prevent accidental misconfigurations.

## Recent Changes (January 2026)
- Added user authentication and authorization system
- Implemented role-based access control (super_admin, admin, user)
- Added user management page for admins
- Added OLT settings page for connection management
- Removed mock data - shows empty states until OLT is connected
- Protected all routes with authentication middleware

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

## User Preferences
- Professional network operations theme
- Dark/light mode support
- Monospace fonts for serial numbers and technical data
- Status color coding (green=online, red=LOS, gray=offline)
