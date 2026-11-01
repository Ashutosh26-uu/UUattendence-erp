// Library: catalogue, issue / return with a late fine per day.
const express = require('express');
const { one, all, run, tx, audit, getSetting } = require('../db');
const { HttpError, str, int, today } = require('../http');
const { requireRole } = require('../auth');
const { crud } = require('../crud');

const router = express.Router();
const req_ = { required: true };

const daysLate = (due, on) => Math.max(0, Math.floor((Date.parse(on) - Date.parse(due)) / 864e5));
const fineFor = (due, on) => daysLate(due, on) * (Number(getSetting('library_fine_per_day')) || 0);
const addDays = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);

router.get('/books', requireRole(), (req, res) => {
  const q = str(req.query.q, 'Search', { max: 100 });
  res.json(all(`SELECT b.*, b.copies - (SELECT COUNT(*) FROM book_issues i WHERE i.book_id = b.id AND i.returned_on IS NULL) AS available
    FROM books b ${q ? 'WHERE b.title LIKE ? OR b.author LIKE ? OR b.accession_no LIKE ? OR b.category LIKE ?' : ''}
    ORDER BY b.title LIMIT 500`, ...(q ? Array(4).fill(`%${q}%`) : [])));
});

router.get('/mine', requireRole(), (req, res) => {
  const now = today();
  res.json(all(`SELECT i.*, b.title, b.author, b.accession_no FROM book_issues i JOIN books b ON b.id = i.book_id
    WHERE i.user_id = ? ORDER BY i.returned_on IS NOT NULL, i.issued_on DESC`, req.user.id)
    .map((i) => ({ ...i, fine: i.returned_on ? i.fine : fineFor(i.due_on, now), overdue: !i.returned_on && i.due_on < now })));
});

const admin = express.Router();
admin.use(requireRole('admin'));

crud(admin, {
  path: '/books', table: 'books', label: 'Book',
  fields: {
    accession_no: (v) => str(v, 'Accession no', { required: true, max: 30 }),
    isbn: (v) => str(v, 'ISBN', { max: 20 }),
    title: (v) => str(v, 'Title', req_),
    author: (v) => str(v, 'Author'),
    category: (v) => str(v, 'Category', { max: 60 }),
    copies: (v) => int(v ?? 1, 'Copies', { required: true, min: 0, max: 1000 }),
    shelf: (v) => str(v, 'Shelf', { max: 30 }),
  },
  listSql: `SELECT b.*, b.copies - (SELECT COUNT(*) FROM book_issues i WHERE i.book_id = b.id AND i.returned_on IS NULL) AS available
    FROM books b ORDER BY b.title`,
});

admin.get('/issues', (req, res) => {
  const now = today();
  const active = req.query.status !== 'all';
  res.json(all(`SELECT i.*, b.title, b.accession_no, u.name AS user_name, u.username, u.role FROM book_issues i
    JOIN books b ON b.id = i.book_id JOIN users u ON u.id = i.user_id ${active ? 'WHERE i.returned_on IS NULL' : ''}
    ORDER BY i.returned_on IS NOT NULL, i.due_on LIMIT 500`)
    .map((i) => ({ ...i, fine: i.returned_on ? i.fine : fineFor(i.due_on, now), overdue: !i.returned_on && i.due_on < now })));
});

admin.post('/issues', (req, res) => {
  const bookId = int(req.body?.book_id, 'Book', req_);
  const username = str(req.body?.username, 'Username / roll no', req_);
  const out = tx(() => {
    const user = one('SELECT u.id FROM users u LEFT JOIN students s ON s.user_id = u.id WHERE (u.username = ? OR s.roll_no = ?) AND u.active = 1', username, username);
    if (!user) throw new HttpError(404, 'No active user with that username or roll no');
    const book = one(`SELECT b.copies - (SELECT COUNT(*) FROM book_issues i WHERE i.book_id = b.id AND i.returned_on IS NULL) AS available FROM books b WHERE b.id = ?`, bookId);
    if (!book) throw new HttpError(404, 'Book not found');
    if (book.available < 1) throw new HttpError(409, 'No copy of this book is available');
    if (one('SELECT 1 FROM book_issues WHERE book_id = ? AND user_id = ? AND returned_on IS NULL', bookId, user.id)) throw new HttpError(409, 'This person already has this book');
    const issued = today();
    const due = addDays(issued, Number(getSetting('library_issue_days')) || 14);
    const r = run('INSERT INTO book_issues(book_id, user_id, issued_on, due_on) VALUES (?, ?, ?, ?)', bookId, user.id, issued, due);
    return { id: Number(r.lastInsertRowid), due_on: due };
  });
  audit(req.user.id, 'book_issued', { ...out, bookId, username });
  res.status(201).json(out);
});

admin.post('/issues/:id/return', (req, res) => {
  const id = int(req.params.id, 'Id', req_);
  const issue = one('SELECT * FROM book_issues WHERE id = ? AND returned_on IS NULL', id);
  if (!issue) throw new HttpError(404, 'Active issue not found');
  const on = today();
  const fine = fineFor(issue.due_on, on);
  run('UPDATE book_issues SET returned_on = ?, fine = ? WHERE id = ?', on, fine, id);
  audit(req.user.id, 'book_returned', { id, fine });
  res.json({ ok: true, fine });
});

router.use('/admin', admin);
module.exports = router;
