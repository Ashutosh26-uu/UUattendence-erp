# United University, Prayagraj — ERP with camera attendance

Attendance is taken by the classroom camera with face recognition. The teacher starts it, the camera recognises students for 5 minutes, and the teacher checks the list, marks anyone the camera missed, and submits.

## Who logs in

| Login tab | Can do |
| --- | --- |
| **Teacher** (employee ID or username) | See the lectures allotted to them (today + weekly), start attendance, live 5-minute camera scan, review list with manual marking, submit, history, notifications |
| **Admin** | Students (one by one or CSV import of thousands), faculty, classes, subjects, rooms and their cameras, lecture allotment (timetable, with clash checks), face enrolment (bulk photos named by roll number, or camera), attendance records and corrections, reports (CSV) |
| **Super admin** | Everything an admin can, plus admin accounts, university settings (scan length, face-match strictness, queue limits), live system monitor, audit log |

## Attendance flow

1. The teacher opens **My lectures** and sees where and when they teach today.
2. **Start attendance** on a lecture. Only the allotted teacher can, once per lecture per day.
3. For 5 minutes (setting), the classroom camera is read every 3 seconds. The browser finds faces and sends only the face numbers (128-number descriptors) to the server, which matches them against that class. Recognised students appear live with their roll number.
4. After 5 minutes the teacher sees:
   - **Registered in class** (official strength)
   - **In class** (the highest number of people the camera saw at once)
   - **Recognised by camera**
   - **Present / Absent**

   Warnings appear when people were seen but not recognised, or when more students are marked present than the camera counted (possible proxy).
5. The teacher marks anyone missed by hand (a manual mark always wins over the camera) and presses **Submit**.
6. The teacher gets a notification: "Attendance saved: 52 of 60 present".

## Built for 4,000–5,000 users

- **During the scan** the recognitions stay in server memory, so a class does not write to the database every few seconds. It is checkpointed every 10 frames, so a server restart does not lose it.
- **On submit**, one transaction with one bulk insert saves the whole class.
- **Peak-load queue.** When more than 500 submissions (setting) arrive within a minute, new ones go into a durable queue (a PostgreSQL table, safe across restarts and across several servers) and the teacher gets an answer immediately. The queue is saved when traffic drops, in the gap between lectures. Anything older than 45 minutes (setting) is saved even during peak, so nothing waits past the next lecture. The teacher is notified when theirs is saved.
- Face galleries per class and logged-in users are cached in memory. Sessions are signed cookies (no database lookup per request). Password hashing runs off the main thread.

Load test (`npm run loadtest`) on a laptop with the embedded database:
- 1,000 classes × 60 students submitted at the same moment
- every submission was answered within 4.2 s (250 saved at once, 750 queued)
- the queue was saved in 8 s
- 60,000 rows were saved with nothing lost
- face matching takes 7.6 ms for a 60-face frame, so one CPU core handles about 390 classes scanning at once

## Run

Needs Node.js 20+.

```bash
npm install
npm start
```

Open http://localhost:3000. With no `DATABASE_URL`, an embedded PostgreSQL (PGlite) is kept in `data/`. The first start creates the `superadmin` account; its one-time password is in `data/initial-super-admin.txt`.

Demo data (3 classes, 120 students, 3 teachers, timetable, two weeks of attendance):

```bash
npm run seed:demo
```

Logins are in `data/demo-logins.txt`.

### Production (university server)

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string (recommended for production; PostgreSQL 14+) |
| `DB_POOL_SIZE` | Connections per app server (default 20) |
| `SESSION_SECRET` | Long random string; must be the same on every app server |
| `SUPER_ADMIN_PASSWORD` | Password for the first super admin (otherwise written to a file) |
| `TRUST_PROXY=1` | When running behind nginx / a load balancer with HTTPS |
| `TZ` | Defaults to `Asia/Kolkata` |
| `PORT`, `HOST` | Default 3000, 0.0.0.0 |

- Run it behind HTTPS (nginx or Caddy). Browsers only allow the computer's camera on https.
- For more capacity, run several app servers behind a load balancer with **sticky sessions**, since live scans are held in the server's memory. All of them share one PostgreSQL.
- **Classroom IP cameras:** in *Rooms and cameras*, set each camera's JPEG snapshot URL (for example `http://user:pass@10.0.5.21/cgi-bin/snapshot.cgi`). The ERP server must be on the campus network to reach them, and only Basic auth is supported.
- Back up the database daily. It holds face data, so restrict access.

## Logo

The logo is the university's own logo (`assets/logo-original.png`). `python scripts/prepare-logo.py` trims it into `public/img/logo.png` (on white), `logo-transparent.png`, `logo-mark.png` (the emblem) and `favicon.png`. To change the logo, replace `assets/logo-original.png` and run the script again.
