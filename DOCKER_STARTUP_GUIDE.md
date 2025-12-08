# Docker Startup Guide

## 🎯 Application Ports

Your Deal Registration Automation application runs on these ports:

| Service | Port | Access URL | Description |
|---------|------|------------|-------------|
| **Frontend** | **3200** | **http://localhost:3200** | React application (main UI) |
| **Backend API** | **4000** | **http://localhost:4000** | Express.js REST API |
| **PostgreSQL** | **5432** | localhost:5432 | Database (internal) |
| **Redis** | **6379** | localhost:6379 | Cache & Queue (internal) |

---

## 🚀 Quick Start

### 1. Start Docker Desktop
First, make sure **Docker Desktop** is running on your machine.

### 2. Build and Start All Services
```bash
cd "c:\Users\brock\Documents\Deal Reg Automation\Deal-Reg-Automation"
docker-compose up -d --build
```

**What this does:**
- `-d` = Run in detached mode (background)
- `--build` = Rebuild images if code changed

**Expected output:**
```
✔ Container dealreg-db        Started
✔ Container dealreg-redis      Started
✔ Container dealreg-backend    Started
✔ Container dealreg-worker     Started
✔ Container dealreg-frontend   Started
```

### 3. Access the Application
Open your browser and go to:
```
http://localhost:3200
```

---

## 📋 Useful Docker Commands

### Check Running Containers
```bash
docker-compose ps
```

**Expected output:**
```
NAME                 STATUS         PORTS
dealreg-backend      Up 2 minutes   0.0.0.0:4000->4000/tcp
dealreg-db           Up 2 minutes   0.0.0.0:5432->5432/tcp
dealreg-frontend     Up 2 minutes   0.0.0.0:3200->80/tcp
dealreg-redis        Up 2 minutes   0.0.0.0:6379->6379/tcp
dealreg-worker       Up 2 minutes
```

### View Logs
```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f frontend
docker-compose logs -f backend
docker-compose logs -f worker
```

### Stop All Services
```bash
docker-compose stop
```

### Start Existing Containers
```bash
docker-compose start
```

### Restart All Services
```bash
docker-compose restart
```

### Rebuild After Code Changes
```bash
docker-compose up -d --build
```

### Stop and Remove Containers
```bash
docker-compose down
```

### Stop and Remove Everything (Including Volumes)
```bash
docker-compose down -v
```
⚠️ **Warning:** This deletes all data in the database!

---

## 🔧 Apply Database Migration

After starting the containers for the first time, apply the performance indexes:

```bash
docker-compose exec backend npm run db:migrate
```

**What this does:**
- Adds indexes to speed up queries by 3-10x
- Safe to run multiple times (won't duplicate indexes)

---

## 🐛 Troubleshooting

### Problem: "Cannot connect to Docker daemon"
**Solution:** Start Docker Desktop application

### Problem: Port 3200 already in use
**Solution:**
```bash
# Find what's using the port
netstat -ano | findstr :3200

# Kill the process (replace PID)
taskkill /PID <PID> /F

# Or change the port in docker-compose.yml
# Change "3200:80" to "3201:80"
```

### Problem: Backend won't start
**Check logs:**
```bash
docker-compose logs backend
```

**Common causes:**
- Database not ready (wait 30 seconds)
- Port 4000 in use
- Environment variables incorrect

### Problem: Frontend shows "Cannot connect to server"
**Solution:**
1. Check backend is running: `docker-compose ps`
2. Verify backend health: `curl http://localhost:4000/health`
3. Check frontend environment:
   ```bash
   docker-compose exec frontend cat /usr/share/nginx/html/assets/index-*.js | grep VITE_API_URL
   ```

### Problem: Database connection errors
**Solution:**
```bash
# Restart database
docker-compose restart db

# Check database logs
docker-compose logs db

# Connect to database manually
docker-compose exec db psql -U dealreg_user -d dealreg
```

---

## 🔄 Development Workflow

### After Making Code Changes

**Frontend changes:**
```bash
# Rebuild only frontend
docker-compose up -d --build frontend
```

**Backend changes:**
```bash
# Backend auto-reloads in dev mode (no rebuild needed)
# Just save your file and watch the logs
docker-compose logs -f backend
```

**Database schema changes:**
```bash
# Run migration
docker-compose exec backend npm run db:migrate
```

---

## 📊 Health Checks

### Check All Services
```bash
# Frontend
curl http://localhost:3200

# Backend API
curl http://localhost:4000/health

# Database
docker-compose exec db pg_isready -U dealreg_user -d dealreg

# Redis
docker-compose exec redis redis-cli ping
```

**Expected responses:**
- Frontend: HTML page
- Backend: `{"status":"ok"}`
- Database: `dealreg-db:5432 - accepting connections`
- Redis: `PONG`

---

## 🗄️ Database Access

### Connect to Database
```bash
docker-compose exec db psql -U dealreg_user -d dealreg
```

### Useful SQL Commands
```sql
-- List all tables
\dt

-- Count deals
SELECT COUNT(*) FROM deal_registrations;

-- Count vendors
SELECT COUNT(*) FROM vendors;

-- See indexes (after migration)
\di

-- Exit
\q
```

---

## 📦 Container Management

### Restart Specific Service
```bash
docker-compose restart backend
docker-compose restart frontend
```

### Rebuild Specific Service
```bash
docker-compose up -d --build backend
```

### View Resource Usage
```bash
docker stats
```

### Clean Up Docker
```bash
# Remove stopped containers
docker container prune

# Remove unused images
docker image prune

# Remove unused volumes
docker volume prune

# Remove everything unused
docker system prune -a
```

---

## 🔐 Environment Variables

Located in `docker-compose.yml`:

**Backend:**
- `NODE_ENV`: development
- `PORT`: 4000
- `DATABASE_URL`: postgresql://dealreg_user:dealreg_password@db:5432/dealreg
- `REDIS_URL`: redis://redis:6379
- `JWT_SECRET`: (change in production!)
- `MAX_FILE_SIZE`: 5GB

**Frontend:**
Built-in during image build, configured in `frontend/.env`:
- `VITE_API_URL`: http://localhost:4000

---

## 📝 Container Architecture

```
┌─────────────────────────────────────────┐
│         Your Computer (Windows)          │
│                                          │
│  ┌────────────────────────────────────┐ │
│  │    Docker Desktop                   │ │
│  │                                     │ │
│  │  ┌──────────┐     ┌──────────┐    │ │
│  │  │ Frontend │     │ Backend  │    │ │
│  │  │  :3200   │────▶│  :4000   │    │ │
│  │  └──────────┘     └────┬─────┘    │ │
│  │                         │          │ │
│  │                    ┌────▼─────┐   │ │
│  │                    │PostgreSQL│   │ │
│  │                    │  :5432   │   │ │
│  │                    └──────────┘   │ │
│  │                                   │ │
│  │  ┌──────────┐     ┌──────────┐  │ │
│  │  │  Redis   │     │  Worker  │  │ │
│  │  │  :6379   │◀────│(bg jobs) │  │ │
│  │  └──────────┘     └──────────┘  │ │
│  └─────────────────────────────────┘ │
└──────────────────────────────────────┘
```

---

## 🚀 First Time Setup Checklist

1. ✅ **Docker Desktop** is installed and running
2. ✅ **Start containers**: `docker-compose up -d --build`
3. ✅ **Wait 30 seconds** for database to be ready
4. ✅ **Apply migration**: `docker-compose exec backend npm run db:migrate`
5. ✅ **Open browser**: http://localhost:3200
6. ✅ **Check health**: All services show "Up" in `docker-compose ps`

---

## 🎯 Quick Reference

**Start everything:**
```bash
docker-compose up -d --build
```

**Access frontend:**
```
http://localhost:3200
```

**Access backend API:**
```
http://localhost:4000
```

**View logs:**
```bash
docker-compose logs -f
```

**Stop everything:**
```bash
docker-compose down
```

**Apply database updates:**
```bash
docker-compose exec backend npm run db:migrate
```

---

## 📞 Need Help?

**Check logs for errors:**
```bash
docker-compose logs backend
docker-compose logs frontend
docker-compose logs db
```

**Common issues:**
- Docker Desktop not running → Start it
- Port conflicts → Change ports in docker-compose.yml
- Database not ready → Wait 30 seconds after `docker-compose up`
- Frontend can't reach backend → Check VITE_API_URL in frontend/.env

---

**Happy Coding! 🚀**
