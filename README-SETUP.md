# Unique Prime Reality CRM

Full-stack CRM with role hierarchy, GPS-verified attendance, lead management,
call recording, team chat and broadcast alerts. FastAPI + React + MongoDB.

## Prerequisites
Python 3.11+, Node 18+ with yarn (`npm i -g yarn`), MongoDB.

## Backend
    cd backend
    pip install -r requirements.txt
    cp .env.example .env  # then edit if needed
    uvicorn server:app --host 0.0.0.0 --port 8001

## Frontend
    cd frontend
    yarn install
    cp .env.example .env
    yarn start        # http://localhost:3000
    yarn build        # production build

## Seeded logins
- Superadmin (Technical Head): `vranda.aggarwal` / `Vranda@123`
- Admin: `sandeep.chauhan` / `Sandeep@123`
- Team leaders: `manish.singh`, `pankaj.verma`, `abhishek.janghu`, `rakesh.shanwal` / `Welcome@123`
- Sales (under abhishek.janghu): `kashish.aggarwal`, `paviter.dahiya` / `Welcome@123`

Change passwords after first login (Profile → Change password).

## Deploying on Railway

This is two separate services (backend + frontend) plus a MongoDB database.
`backend/` and `frontend/` each already have a `Procfile` and `railway.json`
so Railway's Nixpacks builder picks the right start command automatically.

1. **Database** — add a MongoDB instance from Railway's plugin marketplace
   (or use a free MongoDB Atlas cluster) and copy its connection string.

2. **Backend service** — create a Railway service, point its **root
   directory** to `/backend`, then set these variables:
       MONGO_URL=<your MongoDB connection string>
       DB_NAME=upr_crm
       CORS_ORIGINS=<your frontend's Railway URL, e.g. https://your-frontend.up.railway.app>
       JWT_SECRET=<a long random string>
       COOKIE_SECURE=true
       ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME, ADMIN_PHONE
       SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD, SUPERADMIN_NAME, SUPERADMIN_PHONE
       DEFAULT_USER_PASSWORD
       OFFICE_LAT, OFFICE_LNG, OFFICE_RADIUS_M, OFFICE_START, OFFICE_END, OFFICE_LABEL
   (see `backend/.env.example` for the full list). Deploy, then copy the
   backend's public Railway URL.

3. **Frontend service** — create a second Railway service, point its root
   directory to `/frontend`, and set:
       REACT_APP_BACKEND_URL=<your backend's Railway URL>
   Railway will run `yarn install && yarn build` then serve the production
   build with `yarn serve` (added for this purpose — see `frontend/package.json`).

4. Once both are live, update the backend's `CORS_ORIGINS` to the frontend's
   final Railway URL (and redeploy) so cookie-based login works correctly.

5. Change the seeded passwords immediately after first login in production.

## Highlights
- Role hierarchy: superadmin → admin → team_lead → sales / employee
- GPS-verified attendance with configurable office coords + 500 m radius
- Automatic late & overtime calculation, weekly/monthly absentee dashboard
- CSV / manual lead import with hot/raw/custom tags and follow-up filters
- Click-to-call console with browser mic recording
- Team chat groups + broadcast alerts (polling)
- Superadmin can edit anyone (including missed attendance)
- Fully responsive — mobile-friendly for field sales

Built for Unique Prime Reality by Vranda Aggarwal.
