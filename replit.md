# Huawei OLT Manager

## Overview
A professional network operations management application for Huawei MA5801 OLT devices. This tool helps network operators manage GPON ONUs with safety guardrails to prevent accidental misconfigurations.

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
│   ├── app-sidebar.tsx      # Main navigation sidebar
│   ├── bind-onu-dialog.tsx  # ONU binding with validation
│   ├── unbind-onu-dialog.tsx # ONU removal with confirmation
│   ├── onu-verification-dialog.tsx # Quick ONU lookup
│   ├── onu-status-badge.tsx # Status indicators
│   ├── theme-provider.tsx   # Dark/light mode
│   └── theme-toggle.tsx     # Theme switch button
├── pages/
│   ├── unbound-onu.tsx      # Discovered ONUs
│   ├── bound-onu.tsx        # Configured ONUs
│   ├── profiles.tsx         # Line & Service profiles
│   └── vlans.tsx            # VLAN management
└── App.tsx                  # Main app with routing

server/
├── routes.ts                # API endpoints
├── storage.ts               # In-memory data store with validations
└── index.ts                 # Express server setup

shared/
└── schema.ts                # TypeScript types and Zod schemas
```

## API Endpoints

### Read-Only (Safe)
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
- Routing: wouter
- State: In-memory storage (simulated OLT data)

## User Preferences
- Professional network operations theme
- Dark/light mode support
- Monospace fonts for serial numbers and technical data
- Status color coding (green=online, red=LOS, gray=offline)
