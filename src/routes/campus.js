// Hostel rooms and bus routes, and which student is allotted where.
const express = require('express');
const { one, all, run, tx, audit } = require('../db');
const { HttpError, str, int, oneOf, time } = require('../http');
const { requireRole } = require('../auth');
const { crud } = require('../crud');

const router = express.Router();
const req_ = { required: true };

// ---- Student view ----
router.get('/mine', requireRole('student'), (req, res) => {
  const hostel = one(`SELECT r.id AS room_id, r.room_no, r.capacity, h.name AS hostel_name, h.type, h.warden_name, h.warden_phone, a.allotted_on
    FROM hostel_allotments a JOIN hostel_rooms r ON r.id = a.room_id JOIN hostels h ON h.id = r.hostel_id WHERE a.student_id = ?`, req.user.id);
  const roommates = hostel ? all(`SELECT u.name, s.roll_no, c.name AS class_name FROM hostel_allotments a JOIN users u ON u.id = a.student_id
    JOIN students s ON s.user_id = a.student_id JOIN classes c ON c.id = s.class_id WHERE a.room_id = ? AND a.student_id <> ?`, hostel.room_id, req.user.id) : [];
  const transport = one(`SELECT b.*, t.stop FROM transport_allotments t JOIN bus_routes b ON b.id = t.route_id WHERE t.student_id = ?`, req.user.id);
  res.json({ hostel, roommates, transport });
});

const admin = express.Router();
admin.use(requireRole('admin'));

crud(admin, {
  path: '/hostels', table: 'hostels', label: 'Hostel',
  fields: {
    name: (v) => str(v, 'Name', req_),
    type: (v) => oneOf(v || 'boys', 'Type', ['boys', 'girls']),
    warden_name: (v) => str(v, 'Warden name'),
    warden_phone: (v) => str(v, 'Warden phone', { max: 20 }),
  },
  listSql: `SELECT h.*, (SELECT COUNT(*) FROM hostel_rooms r WHERE r.hostel_id = h.id) AS rooms,
    (SELECT COALESCE(SUM(capacity), 0) FROM hostel_rooms r WHERE r.hostel_id = h.id) AS beds,
    (SELECT COUNT(*) FROM hostel_allotments a JOIN hostel_rooms r ON r.id = a.room_id WHERE r.hostel_id = h.id) AS occupied
    FROM hostels h ORDER BY h.name`,
});

crud(admin, {
  path: '/rooms', table: 'hostel_rooms', label: 'Room',
  fields: {
    hostel_id: (v) => int(v, 'Hostel', req_),
    room_no: (v) => str(v, 'Room no', { required: true, max: 20 }),
    capacity: (v) => int(v ?? 2, 'Beds', { required: true, min: 1, max: 20 }),
  },
  listSql: `SELECT r.*, h.name AS hostel_name, (SELECT COUNT(*) FROM hostel_allotments a WHERE a.room_id = r.id) AS occupied
    FROM hostel_rooms r JOIN hostels h ON h.id = r.hostel_id ORDER BY h.name, r.room_no`,
});

admin.get('/hostel-allotments', (req, res) => {
  res.json(all(`SELECT a.student_id, a.room_id, a.allotted_on, u.name, s.roll_no, c.name AS class_name, r.room_no, h.name AS hostel_name
    FROM hostel_allotments a JOIN users u ON u.id = a.student_id JOIN students s ON s.user_id = a.student_id JOIN classes c ON c.id = s.class_id
    JOIN hostel_rooms r ON r.id = a.room_id JOIN hostels h ON h.id = r.hostel_id ORDER BY h.name, r.room_no, s.roll_no`));
});

admin.post('/hostel-allotments', (req, res) => {
  const studentId = int(req.body?.student_id, 'Student', req_);
  const roomId = int(req.body?.room_id, 'Room', req_);
  tx(() => {
    if (!one('SELECT 1 FROM students WHERE user_id = ?', studentId)) throw new HttpError(404, 'Student not found');
    const room = one(`SELECT r.capacity, (SELECT COUNT(*) FROM hostel_allotments a WHERE a.room_id = r.id AND a.student_id <> ?) AS occupied
      FROM hostel_rooms r WHERE r.id = ?`, studentId, roomId);
    if (!room) throw new HttpError(404, 'Room not found');
    if (room.occupied >= room.capacity) throw new HttpError(409, 'This room is full');
    run(`INSERT INTO hostel_allotments(student_id, room_id) VALUES (?, ?)
      ON CONFLICT(student_id) DO UPDATE SET room_id = excluded.room_id, allotted_on = date('now')`, studentId, roomId);
  });
  audit(req.user.id, 'hostel_allotted', { studentId, roomId });
  res.status(201).json({ ok: true });
});

admin.delete('/hostel-allotments/:studentId', (req, res) => {
  run('DELETE FROM hostel_allotments WHERE student_id = ?', int(req.params.studentId, 'Student', req_));
  res.json({ ok: true });
});

crud(admin, {
  path: '/routes', table: 'bus_routes', label: 'Route',
  fields: {
    name: (v) => str(v, 'Route name', req_),
    bus_no: (v) => str(v, 'Bus no', { max: 20 }),
    driver_name: (v) => str(v, 'Driver name'),
    driver_phone: (v) => str(v, 'Driver phone', { max: 20 }),
    departure_time: (v) => time(v, 'Departure time'),
    stops: (v) => str(v, 'Stops', { max: 1000 }),
  },
  listSql: `SELECT b.*, (SELECT COUNT(*) FROM transport_allotments t WHERE t.route_id = b.id) AS riders FROM bus_routes b ORDER BY b.name`,
});

admin.get('/transport-allotments', (req, res) => {
  res.json(all(`SELECT t.student_id, t.route_id, t.stop, u.name, s.roll_no, c.name AS class_name, b.name AS route_name, b.bus_no
    FROM transport_allotments t JOIN users u ON u.id = t.student_id JOIN students s ON s.user_id = t.student_id
    JOIN classes c ON c.id = s.class_id JOIN bus_routes b ON b.id = t.route_id ORDER BY b.name, s.roll_no`));
});

admin.post('/transport-allotments', (req, res) => {
  const studentId = int(req.body?.student_id, 'Student', req_);
  const routeId = int(req.body?.route_id, 'Route', req_);
  if (!one('SELECT 1 FROM students WHERE user_id = ?', studentId)) throw new HttpError(404, 'Student not found');
  if (!one('SELECT 1 FROM bus_routes WHERE id = ?', routeId)) throw new HttpError(404, 'Route not found');
  run(`INSERT INTO transport_allotments(student_id, route_id, stop) VALUES (?, ?, ?)
    ON CONFLICT(student_id) DO UPDATE SET route_id = excluded.route_id, stop = excluded.stop`, studentId, routeId, str(req.body?.stop, 'Stop', { max: 100 }));
  audit(req.user.id, 'transport_allotted', { studentId, routeId });
  res.status(201).json({ ok: true });
});

admin.delete('/transport-allotments/:studentId', (req, res) => {
  run('DELETE FROM transport_allotments WHERE student_id = ?', int(req.params.studentId, 'Student', req_));
  res.json({ ok: true });
});

router.use('/admin', admin);
module.exports = router;
