# NovaTalent — Full-Stack Recruiting Platform

A production-ready recruiting platform with separate dashboards for companies and applicants.

## Quick Start

```bash
# Install dependencies
npm install

# Start the server
npm start
```

Then open **http://localhost:3000**

---

## Features

### For Companies 🏢
- Register a company account
- Post/edit/pause/delete job listings (title, dept, location, type, salary, requirements)
- View applications per job
- Pipeline management — move candidates through stages:
  `Applied → Reviewing → Interviewing → Offered → Hired / Rejected`
- Overview dashboard with live stats
- Company profile settings

### For Applicants 👤
- Register a personal account
- Browse all active jobs (search + filter by dept, type)
- View full job details in a slide-in panel
- Apply with optional cover letter (resume auto-attached)
- Track all applications and their stage
- Upload resume (PDF/DOC)
- Edit profile: name, phone, LinkedIn, bio

### Public
- `/applicant/browse.html` — browse all jobs without signing in
- Sign-up prompt to apply

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Backend | Node.js + Express |
| Auth | JWT (jsonwebtoken) + bcryptjs |
| Database | JSON file (db.json) — drop-in replaceable with SQLite/Postgres |
| File uploads | Multer |
| Frontend | Vanilla HTML/CSS/JS (no framework) |
| Fonts | Google Fonts: DM Sans + DM Serif Display |

---

## Project Structure

```
recruiting-app/
├── server.js          # Express API + route definitions
├── database.js        # JSON-based DB layer
├── db.json            # Auto-created database file
├── package.json
└── public/
    ├── index.html           # Landing + Login + Register
    ├── uploads/             # Uploaded resumes & logos
    ├── company/
    │   └── dashboard.html   # Company dashboard
    └── applicant/
        ├── dashboard.html   # Applicant dashboard
        └── browse.html      # Public job board
```

---

## API Routes

### Auth
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Register (company or applicant) |
| POST | `/api/auth/login` | Login |
| GET  | `/api/auth/me` | Get current user |

### Jobs (public)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/jobs` | List active jobs (with filters) |
| GET | `/api/jobs/:id` | Get job detail |

### Company (auth required)
| Method | Path | Description |
|--------|------|-------------|
| GET/PUT | `/api/company/profile` | Company profile |
| GET | `/api/company/stats` | Dashboard stats |
| GET/POST | `/api/company/jobs` | List/create jobs |
| PUT/DELETE | `/api/company/jobs/:id` | Update/delete job |
| GET | `/api/company/jobs/:id/applications` | Applications per job |
| GET | `/api/company/applications` | All company applications |
| PUT | `/api/company/applications/:id/status` | Update candidate stage |

### Applicant (auth required)
| Method | Path | Description |
|--------|------|-------------|
| GET/PUT | `/api/applicant/profile` | Applicant profile |
| POST | `/api/applicant/resume` | Upload resume |
| POST | `/api/applicant/apply/:jobId` | Apply to job |
| GET | `/api/applicant/applications` | My applications |

---

## Upgrading the Database

To switch from JSON → SQLite or Postgres, replace `database.js` with an adapter for your preferred DB. The API layer in `server.js` stays unchanged.

---

## Default Port

Server runs on **port 3000**. Set `PORT` env variable to change.
