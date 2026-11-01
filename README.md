# UU College ERP — camera attendance

A standard college ERP (students, teachers, classes, subjects, timetable, exams and marks, fees, notices, reports) where **attendance is taken by the classroom camera with face recognition** instead of a paper register.

## How camera attendance works

1. **Face enrolment (once).** Admin or teacher opens *Face enrolment*, picks the class and captures a photo with the classroom camera (a group photo works). Every detected face appears with a name dropdown; choose the student and save. 2–3 photos per student give the best results. If a face looks like a student who is already enrolled, the system warns before saving.
2. **Teacher starts attendance.** Nothing happens until the teacher presses **Start attendance** for their class + subject. Only the teacher assigned to that class and subject can do this.
3. **Capture.** The camera takes a photo of the class. Faces are detected in the browser, and the server matches them against the enrolled photos. The teacher can capture again from another angle; students already recognised stay present.
4. **Check the numbers before saving.** The screen shows:
   - **Registered in class**: official strength
   - **Counted by camera**: how many people the camera saw
   - **Recognised by camera**, **Present**, **Absent**, **Not marked**

   It warns when faces were not recognised, when students have no face photo, and when more students are marked present than the camera counted (a sign of proxy attendance).
5. **Manual marking at any time.** The teacher can mark any student Present or Absent by hand. A manual mark always wins over the camera.
6. **Submit.** Attendance counts only after the teacher submits. Unmarked students are saved as absent. After that the record is locked; only the admin can correct it, and every correction is written to the audit log.

## Roles

- **Admin**: departments, classes (with the classroom camera URL), subjects, teachers, students (one by one or a pasted list), subject allotment, timetable, fee heads and fee collection with receipts, notices, attendance reports (CSV), corrections, settings, audit log.
- **Teacher**: take attendance, face enrolment, their students, exams and marks, attendance report (CSV), timetable, notices.
- **Student**: attendance by subject (with a warning below 75%), marks, fees and receipts, timetable, notices, profile.

## Run it

Needs Node.js 22.13 or newer.

```bash
npm install
npm start
```

Open http://localhost:3000. On the first start an `admin` account is created and its one-time password is saved in `data/initial-admin.txt`. It has to be changed at the first login.

To load demo data (2 classes, 3 subjects, 2 teachers, 24 students, 3 weeks of past attendance):

```bash
npm run seed:demo
```

The demo logins are saved in `data/demo-logins.txt`.

## Cameras

- **Classroom IP camera**: in *Classes*, set the camera's JPEG snapshot URL, for example `http://user:pass@192.168.1.50/cgi-bin/snapshot.cgi`. The server fetches the picture, so the camera password never reaches the browser. Only Basic auth is supported.
- **Laptop or USB camera**: pick "This computer's camera". Browsers only allow camera access over **https** or on `localhost`, so on the campus network run the ERP behind HTTPS (for example nginx or Caddy with a certificate) and set `TRUST_PROXY=1`.
- **Upload a photo**: a fallback if no camera is available.

Tips: use a camera with at least 1080p that sees every row from the front, with good light. If back-row faces are missed, lower *Face detection confidence* in Settings. If look-alikes get mixed up, lower *Face match strictness* (for example 0.45).

## Settings (environment)

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | 3000 | Port to listen on |
| `HOST` | 0.0.0.0 | Address to listen on |
| `DATA_DIR` | `./data` | Where the SQLite database is kept |
| `TRUST_PROXY` | (off) | Set to `1` when running behind an HTTPS reverse proxy |

## Tech

Node.js + Express 5, SQLite (`node:sqlite`), plain HTML/CSS/JS, and [face-api.js](https://github.com/vladmandic/face-api) (TensorFlow.js) for detection in the browser. Matching runs on the server against 128-number face descriptors, so a teacher's browser never receives other students' face data. Passwords use scrypt; sessions use HttpOnly SameSite cookies; a strict Content-Security-Policy is set on every page.

Back up the `data/` folder regularly. It holds the database, including face data.
