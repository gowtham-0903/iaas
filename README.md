# IAAS Local Setup Guide

This repository contains two apps:

- `iaas-backend`: Flask + SQLAlchemy + MySQL API
- `iaas-frontend`: React + Vite UI

Use this guide to run the code locally for testing.

## Prerequisites

- Python 3.9+ or the provided virtual environment
- Node.js 18+ and npm
- MySQL 8+
- A browser for the frontend

## Project Structure

- `iaas-backend/` - API server, models, migrations, seed script
- `iaas-frontend/` - React UI
- `ROLES_AND_ACCESS.md` - role and permission reference

## Backend Setup

1. Open a terminal in `iaas-backend/`.
2. Create and activate a Python environment if needed.
3. Install dependencies:

```bash
pip install -r requirements.txt
```

4. Create a MySQL database named `iaas`.
5. Configure backend environment variables in `iaas-backend/.env`.

Example:

```env
DATABASE_URL=mysql://root:root@localhost:3306/iaas
JWT_SECRET_KEY=replace-with-secure-random-value
FLASK_ENV=development
FLASK_APP=wsgi.py
```

6. Run database migrations:

```bash
python -m flask db upgrade
```

7. Seed the default admin user:

```bash
python seed.py
```

Default seeded admin:

- Email: `admin@meedenlabs.com`
- Password: `admin@#1234`

8. Start the backend server:

```bash
python -m flask run --host 127.0.0.1 --port 5001
```

The backend will run at `http://127.0.0.1:5001`.

## Frontend Setup

1. Open a second terminal in `iaas-frontend/`.
2. Install dependencies:

```bash
npm install
```

3. Start the frontend:

```bash
npm run dev
```

The frontend will run at `http://localhost:5173`.

## Test Flow

Recommended local test flow:

1. Start MySQL.
2. Apply backend migrations.
3. Seed the admin account.
4. Start the backend server.
5. Start the frontend.
6. Log in using the seeded admin account.
7. Verify these main screens:
   - Users
   - Clients
   - Job Descriptions
   - AI Skill Extraction
   - Candidates

## Notes For Testing

- Uploaded JD files are stored under `iaas-backend/uploads/jd_files/`.
- The frontend talks to the backend at `http://127.0.0.1:5001`.
- If you change the backend port, update `iaas-frontend/src/api/axiosInstance.js`.
- If the database schema changes, run `python -m flask db upgrade` again.

## Useful Files

- `iaas-backend/app/__init__.py` - Flask app setup
- `iaas-backend/app/config.py` - backend config and database settings
- `iaas-frontend/src/api/axiosInstance.js` - frontend API base URL
- `ROLES_AND_ACCESS.md` - permissions and role guide

## Troubleshooting

- If login fails, confirm the backend is running and cookies are enabled in the browser.
- If the backend returns database errors, confirm MySQL is running and `DATABASE_URL` is correct.
- If the frontend cannot load data, verify the backend URL in `axiosInstance.js`.
