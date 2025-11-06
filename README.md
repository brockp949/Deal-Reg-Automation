# Deal Registration Automation Tool

A comprehensive web-based platform for automating vendor deal registration tracking by processing emails, meeting transcripts, and CRM exports.

## Features

- **Intelligent File Processing**: Upload and parse .mbox emails, transcripts, and vTiger CSV exports
- **Automated Data Extraction**: AI-powered extraction of vendor and deal information
- **Vendor Management**: Track vendors and their associated deals in one place
- **Export & Email**: Generate Excel reports and email them to partners
- **Scalable Architecture**: Handle large files efficiently with background processing

## Tech Stack

### Frontend
- React 18 + TypeScript
- Tailwind CSS + shadcn/ui
- TanStack Query (React Query)
- React Hook Form + Zod

### Backend
- Node.js 20+ with TypeScript
- Express.js
- PostgreSQL 15+
- Redis (for job queues)
- Bull MQ (background jobs)

### File Processing
- mailparser (emails)
- csv-parser (CSV files)
- Anthropic Claude API (AI extraction)

## Project Structure

```
deal-reg-automation/
├── backend/           # Node.js/Express API
├── frontend/          # React application
├── docker-compose.yml # Local development setup
└── README.md
```

## Getting Started

### Prerequisites
- Node.js 20+
- Docker & Docker Compose
- PostgreSQL 15+
- Redis 7+

### Quick Start

1. Clone the repository
```bash
git clone <repo-url>
cd deal-reg-automation
```

2. Set up environment variables
```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

3. Start with Docker Compose
```bash
docker-compose up -d
```

4. Access the application
- Frontend: http://localhost:3000
- Backend API: http://localhost:4000
- API Docs: http://localhost:4000/api-docs

### Development Setup (Without Docker)

#### Backend
```bash
cd backend
npm install
npm run db:migrate
npm run dev
```

#### Frontend
```bash
cd frontend
npm install
npm run dev
```

## Development Roadmap

### Phase 1: MVP (Current)
- [x] Project setup
- [ ] Basic file upload
- [ ] Simple parsing (mbox, CSV, text)
- [ ] Manual vendor/deal entry
- [ ] Basic list views
- [ ] Excel export

### Phase 2: AI Integration
- [ ] Claude/GPT-4 entity extraction
- [ ] Automated vendor matching
- [ ] Confidence scoring
- [ ] Duplicate detection

### Phase 3: Advanced Features
- [ ] Email sending
- [ ] Advanced filtering & search
- [ ] Analytics dashboard
- [ ] Bulk operations

### Phase 4: Polish & Scale
- [ ] Performance optimization
- [ ] Production deployment
- [ ] User documentation

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.

## License

MIT License - see [LICENSE](LICENSE) for details
