# CarbonEYE — Web Application

**"Truth is not declared, it's measured."**

---

## Overview

This repository contains the web application and API server for **CarbonEYE**. It is designed to provide an immutable, verifiable, and user-friendly interface for the CarbonEYE ESG certification pipeline.

The application allows corporate users to:
- **Request ESG Certification**: Submit company and facility data for satellite and IoT analysis.
- **Monitoring Dashboard**: Visualize real-time and historical data from Sentinel-5P, PRISMA, and ground IoT sensors.
- **Certificate Verification**: Access and download SHA-256 hashed ESG certificates.
- **Supply Chain Analysis**: Manage complex certification for multi-facility groups.

---

## Tech Stack

This project is a **TypeScript Monorepo** managed with `pnpm` workspaces.

- **Frontend**: React 19, Vite, Tailwind CSS 4, Framer Motion.
- **Backend**: Node.js 22, Express 5.
- **Database**: PostgreSQL with Drizzle ORM.
- **Validation**: Zod.
- **Infrastructure**: Designed for deployment on **Vercel** and integration with **Azure Functions** (Python Pipeline).

---

## Project Structure

```text
sito/
├── artifacts/
│   ├── api-server/         # Express 5 backend API
│   └── carboneye/          # React 19 frontend application
├── lib/
│   ├── api-client-react/   # Generated API hooks (Orval)
│   ├── api-spec/           # OpenAPI / Swagger definition
│   ├── api-zod/            # Shared Zod schemas
│   └── db/                 # Database schema and Drizzle client
├── scripts/                # Build and utility scripts
└── pnpm-workspace.yaml     # Monorepo workspace configuration
```

---

## Getting Started (Local Development)

### Prerequisites
- Node.js 22+
- pnpm 10+

### Installation
```bash
# Install dependencies
pnpm install
```

### Development
```bash
# Run the API server
pnpm --filter @workspace/api-server run dev

# Run the Frontend (in a separate terminal)
pnpm --filter @workspace/carboneye dev
```

---

## Deployment

The project deploys on **Vercel**, configured via `vercel.json`:
1. Connect the Vercel project to the `Web_App_CarbonEYE` GitHub repository.
2. Add the required environment variables in the Vercel project settings (see `.env.example`).
3. Vercel runs the build command, which builds the API server and frontend and copies the frontend output into `public/`.

---

## Environment Variables

Ensure the following are configured in your environment:

```bash
DATABASE_URL=           # PostgreSQL connection string
SESSION_SECRET=         # Random string for auth sessions
AZURE_FUNCTIONS_URL=    # URL of the Python Pipeline (Azure)
AZURE_FUNCTIONS_KEY=    # API Key for Azure Functions
```
