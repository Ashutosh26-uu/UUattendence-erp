// Classroom IP camera. The browser cannot read most IP cameras directly (credentials,
// CORS, mixed content), so the server fetches one JPEG snapshot and passes it on.
// The camera URL (with its password) never leaves the server.
const express = require('express');
const { int, HttpError } = require('../http');
const { requireRole } = require('../auth');
const { assertClassAccess } = require('../access');

const router = express.Router();
router.use(requireRole('admin', 'teacher'));

const MAX_BYTES = 15 * 1024 * 1024;

router.get('/:classId/snapshot', async (req, res) => {
  const cls = assertClassAccess(req.user, int(req.params.classId, 'Class', { required: true }));
  if (!cls.camera_url) throw new HttpError(404, 'No camera is set up for this class');

  const url = new URL(cls.camera_url);
  const headers = {};
  if (url.username || url.password) {
    headers.Authorization = `Basic ${Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString('base64')}`;
    url.username = '';
    url.password = '';
  }

  let upstream;
  try {
    upstream = await fetch(url, { headers, signal: AbortSignal.timeout(8000), redirect: 'error' });
  } catch {
    throw new HttpError(502, 'Could not reach the classroom camera');
  }
  if (upstream.status === 401) throw new HttpError(502, 'The camera refused the username/password (only Basic auth is supported)');
  if (!upstream.ok) throw new HttpError(502, `Camera answered with error ${upstream.status}`);
  const type = upstream.headers.get('content-type') || '';
  if (!type.startsWith('image/')) throw new HttpError(502, 'The camera URL did not return an image. Use the camera\'s JPEG snapshot URL.');
  const buf = Buffer.from(await upstream.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new HttpError(502, 'Camera image is too large');
  res.set({ 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.send(buf);
});

module.exports = router;
