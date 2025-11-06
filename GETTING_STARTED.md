# Getting Started with Deal Registration Automation Tool

## What's Been Built - Phase 1 Foundation

Congratulations! I've successfully built the foundational Phase 1 MVP of your Deal Registration Automation Tool. Here's what's complete:

### ✅ Completed Components

#### Backend (Node.js + TypeScript + Express)
- **Database Schema**: PostgreSQL with full tables for vendors, deals, contacts, files, and processing jobs
- **REST API Endpoints**:
  - `/api/vendors` - Full CRUD operations for vendor management
  - `/api/deals` - Full CRUD operations for deal registrations
  - `/api/contacts` - Contact management
  - `/api/files` - File upload with validation (single & batch)
  - `/api/export` - Excel and CSV export functionality
- **File Parsers**:
  - **.mbox parser** - Extracts emails from mbox files
  - **CSV parser** - Handles vTiger CRM exports with auto-detection
  - **Transcript parser** - Processes text/PDF/DOCX meeting transcripts
- **Configuration**: Environment-based config, logging (Winston), validation (Zod)
- **File Upload**: Multer-based upload with type validation and size limits

#### Frontend (React + TypeScript + Tailwind CSS)
- **React App Structure**: With React Router, TanStack Query, and Zustand
- **UI Framework**: Tailwind CSS with shadcn/ui design system
- **Pages** (placeholders ready for enhancement):
  - Dashboard with KPI cards
  - Vendors list view
  - Vendor detail view
  - File upload page
- **API Client**: Axios-based with interceptors
- **Utilities**: Date/currency formatting, file helpers

#### Infrastructure
- **Docker Compose**: Full local development environment
- **Services**: PostgreSQL, Redis, Backend API, Frontend, Background Worker

---

## Getting Started

### Prerequisites

Make sure you have these installed on your system:

```bash
- Node.js 20+ (https://nodejs.org/)
- Docker Desktop (https://www.docker.com/products/docker-desktop/)
- Git (https://git-scm.com/)
```

### Step 1: Environment Setup

1. **Backend Environment Variables**
   ```bash
   cd backend
   cp .env.example .env
   ```

   Edit `backend/.env` and set your configuration:
   ```env
   DATABASE_URL=postgresql://dealreg_user:dealreg_password@localhost:5432/dealreg
   REDIS_URL=redis://localhost:6379
   JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
   ```

2. **Frontend Environment Variables**
   ```bash
   cd ../frontend
   cp .env.example .env
   ```

### Step 2: Start with Docker (Recommended)

The easiest way to get everything running:

```bash
# From the project root directory
docker-compose up -d
```

This will start:
- PostgreSQL database on port 5432
- Redis on port 6379
- Backend API on port 4000
- Frontend on port 3000

**First time setup**: Wait 30 seconds for containers to initialize, then run migrations:

```bash
docker-compose exec backend npm run db:migrate
```

Access the application:
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:4000
- **Health Check**: http://localhost:4000/health

### Step 3: Alternative - Manual Setup (Without Docker)

If you prefer not to use Docker:

#### 1. Start PostgreSQL and Redis

Install and start PostgreSQL 15+ and Redis 7+ on your machine.

#### 2. Backend Setup

```bash
cd backend
npm install
npm run db:migrate
npm run dev
```

The backend will start on http://localhost:4000

#### 3. Frontend Setup

In a new terminal:

```bash
cd frontend
npm install
npm run dev
```

The frontend will start on http://localhost:3000

---

## Testing the Application

### 1. Test Backend API

Check if the backend is running:

```bash
curl http://localhost:4000/health
```

You should see:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": 123.456
}
```

### 2. Create a Test Vendor

```bash
curl -X POST http://localhost:4000/api/vendors \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Acme Corporation",
    "industry": "Technology",
    "website": "https://acme.com",
    "notes": "Test vendor"
  }'
```

### 3. Get All Vendors

```bash
curl http://localhost:4000/api/vendors
```

### 4. Upload a Test File

Create a simple CSV file `test.csv`:
```csv
Account Name,Opportunity Name,Amount,Status
Acme Corp,Cloud Migration,50000,Approved
TechPro,Security Upgrade,25000,Registered
```

Upload it:
```bash
curl -X POST http://localhost:4000/api/files/upload \
  -F "file=@test.csv"
```

---

## Project Structure

```
deal-reg-automation/
├── backend/
│   ├── src/
│   │   ├── config/           # Configuration management
│   │   ├── db/               # Database connection & migrations
│   │   │   └── schema.sql    # Database schema
│   │   ├── parsers/          # File parsers (mbox, CSV, transcript)
│   │   ├── routes/           # API route handlers
│   │   │   ├── vendors.ts
│   │   │   ├── deals.ts
│   │   │   ├── files.ts
│   │   │   ├── contacts.ts
│   │   │   └── export.ts
│   │   ├── types/            # TypeScript type definitions
│   │   ├── utils/            # Helper functions
│   │   └── index.ts          # Express server entry point
│   ├── package.json
│   └── tsconfig.json
│
├── frontend/
│   ├── src/
│   │   ├── components/       # React components
│   │   │   └── Layout.tsx
│   │   ├── lib/              # Utilities and API client
│   │   │   ├── api.ts
│   │   │   └── utils.ts
│   │   ├── pages/            # Page components
│   │   │   ├── Dashboard.tsx
│   │   │   ├── Vendors.tsx
│   │   │   ├── VendorDetail.tsx
│   │   │   └── FileUpload.tsx
│   │   ├── types/            # TypeScript types
│   │   ├── App.tsx           # Main app component
│   │   └── main.tsx          # Entry point
│   ├── package.json
│   └── vite.config.ts
│
├── docker-compose.yml         # Docker orchestration
└── README.md                  # Project overview
```

---

## What's Next - Phase 2 Enhancements

The foundation is complete! Here's what you can build next:

### Immediate Next Steps (You Choose!)

1. **Enhance File Upload UI** ⭐
   - Add react-dropzone for drag-and-drop
   - Show upload progress
   - Display uploaded files list
   - Add file processing triggers

2. **Build Vendor Management UI** ⭐
   - Implement vendor list with filtering
   - Add TanStack Table for data grid
   - Create vendor detail page with tabs
   - Add forms for creating/editing vendors

3. **Complete Deal Management**
   - Deal list view with sorting/filtering
   - Deal detail modal/page
   - Status update workflow
   - Probability calculator

4. **AI Integration** (Phase 2)
   - Add Anthropic Claude API integration
   - Intelligent entity extraction
   - Confidence scoring
   - Auto-matching and deduplication

5. **Email Functionality**
   - Configure Nodemailer
   - Email report sending
   - Templates for different report types

6. **Advanced Search**
   - Full-text search across vendors/deals
   - Autocomplete suggestions
   - Saved filters

### Recommended Priority

I recommend starting with:
1. **File Upload UI** - Get the core workflow working end-to-end
2. **Vendor List View** - See and manage extracted data
3. **AI Integration** - Make extraction truly intelligent

---

## Common Commands

### Docker

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f backend
docker-compose logs -f frontend

# Stop all services
docker-compose down

# Rebuild containers
docker-compose up -d --build

# Run migrations
docker-compose exec backend npm run db:migrate

# Access database
docker-compose exec db psql -U dealreg_user -d dealreg
```

### Development

```bash
# Backend
cd backend
npm run dev          # Start dev server
npm run build        # Build TypeScript
npm run db:migrate   # Run migrations
npm run lint         # Lint code

# Frontend
cd frontend
npm run dev          # Start dev server
npm run build        # Build for production
npm run preview      # Preview production build
```

---

## Troubleshooting

### Backend won't start
- Check PostgreSQL is running: `docker-compose ps`
- Check database connection in `.env`
- View logs: `docker-compose logs backend`

### Frontend can't connect to backend
- Verify backend is running on port 4000
- Check VITE_API_URL in frontend/.env
- Check CORS settings in backend config

### Database errors
- Reset database: `docker-compose down -v` then `docker-compose up -d`
- Re-run migrations: `docker-compose exec backend npm run db:migrate`

### Port already in use
```bash
# Find process using port 3000 or 4000
netstat -ano | findstr :3000

# Kill the process (Windows)
taskkill /PID <PID> /F
```

---

## API Documentation

### Vendor Endpoints

```
GET    /api/vendors              Get all vendors (with pagination & filters)
GET    /api/vendors/:id          Get vendor by ID
POST   /api/vendors              Create new vendor
PUT    /api/vendors/:id          Update vendor
DELETE /api/vendors/:id          Delete vendor
GET    /api/vendors/:id/deals    Get vendor's deals
GET    /api/vendors/:id/contacts Get vendor's contacts
```

### Deal Endpoints

```
GET    /api/deals                Get all deals (with pagination & filters)
GET    /api/deals/:id            Get deal by ID
POST   /api/deals                Create new deal
PUT    /api/deals/:id            Update deal
DELETE /api/deals/:id            Delete deal
PATCH  /api/deals/:id/status     Update deal status
```

### File Endpoints

```
GET    /api/files                Get all files
POST   /api/files/upload         Upload single file
POST   /api/files/batch-upload   Upload multiple files
GET    /api/files/:id            Get file details
DELETE /api/files/:id            Delete file
POST   /api/files/:id/process    Trigger file processing
```

### Export Endpoints

```
POST   /api/export/excel         Generate Excel report
POST   /api/export/csv           Generate CSV report
```

---

## Support & Next Steps

You now have a fully functional foundation! The system can:
- ✅ Store vendors, deals, and contacts in PostgreSQL
- ✅ Upload and validate files
- ✅ Parse .mbox, CSV, and text files
- ✅ Export data to Excel/CSV
- ✅ Serve a React frontend with routing

**Ready to continue?** Let me know which feature you'd like to build next, and I'll help you implement it step by step!

Common next requests:
- "Build the file upload UI with drag and drop"
- "Create the vendors list page with filtering"
- "Add AI-powered data extraction"
- "Implement the dashboard with real data"
