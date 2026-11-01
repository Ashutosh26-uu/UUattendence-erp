// Camera + face detection in the browser (face-api.js / TensorFlow.js).
// Each detected face becomes a 128-number descriptor that is sent to the server for matching.
import * as faceapi from '/vendor/face-api/face-api.esm.js';
import { h, toast } from './common.js';

const MAX_SIDE = 2560; // bigger frames find smaller (back-row) faces but run slower

let modelsReady = null;
export function loadModels() {
  if (!modelsReady) {
    modelsReady = (async () => {
      try { await faceapi.tf.setBackend('webgl'); } catch { /* falls back to cpu */ }
      await faceapi.tf.ready();
      await Promise.all([
        faceapi.nets.ssdMobilenetv1.loadFromUri('/models'),
        faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
        faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
      ]);
    })();
    modelsReady.catch(() => { modelsReady = null; });
  }
  return modelsReady;
}

export async function detectFaces(canvas, minConfidence = 0.5) {
  await loadModels();
  const found = await faceapi
    .detectAllFaces(canvas, new faceapi.SsdMobilenetv1Options({ minConfidence, maxResults: 300 }))
    .withFaceLandmarks()
    .withFaceDescriptors();
  return found
    .map((r) => ({
      box: { x: r.detection.box.x, y: r.detection.box.y, width: r.detection.box.width, height: r.detection.box.height },
      score: r.detection.score,
      descriptor: Array.from(r.descriptor),
    }))
    .sort((a, b) => a.box.x - b.box.x);
}

// Square crop around a face, with some margin, as a small JPEG data URL.
export function cropFace(canvas, box, size = 160) {
  const side = Math.max(box.width, box.height) * 1.5;
  const sx = Math.max(0, box.x + box.width / 2 - side / 2);
  const sy = Math.max(0, box.y + box.height / 2 - side / 2);
  const out = document.createElement('canvas');
  out.width = size;
  out.height = size;
  out.getContext('2d').drawImage(canvas, sx, sy, side, side, 0, 0, size, size);
  return out.toDataURL('image/jpeg', 0.85);
}

function toCanvas(source, w, h_) {
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h_));
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h_ * scale);
  c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
  return c;
}

// Draws the captured frame with a box per face. labels[i] = { text, kind: 'ok' | 'warn' | 'muted' }
export function drawResult(target, frame, faces, labels = []) {
  target.width = frame.width;
  target.height = frame.height;
  const ctx = target.getContext('2d');
  ctx.drawImage(frame, 0, 0);
  const lw = Math.max(2, Math.round(frame.width / 500));
  const font = Math.max(12, Math.round(frame.width / 70));
  ctx.font = `600 ${font}px system-ui, sans-serif`;
  faces.forEach((f, i) => {
    const label = labels[i] || { text: `Face ${i + 1}`, kind: 'muted' };
    const color = label.kind === 'ok' ? '#2fbf71' : label.kind === 'warn' ? '#f0a020' : '#8fa3bf';
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.strokeRect(f.box.x, f.box.y, f.box.width, f.box.height);
    const tw = ctx.measureText(label.text).width + 8;
    const ty = Math.max(0, f.box.y - font - 6);
    ctx.fillStyle = color;
    ctx.fillRect(f.box.x, ty, tw, font + 6);
    ctx.fillStyle = '#0b0e12';
    ctx.fillText(label.text, f.box.x + 4, ty + font);
  });
}

// Camera picker + preview. Sources: this device's camera (laptop / USB classroom camera),
// the classroom IP camera (through the server), or an uploaded photo.
export function cameraPanel({ classId, hasCamera }) {
  const stage = h('div', { class: 'camera-stage' }, h('div', { class: 'placeholder', text: 'Choose a camera source' }));
  const status = h('div', { class: 'cam-status' });
  const deviceSel = h('select', { class: 'hidden', 'aria-label': 'Camera device' });
  const fileInput = h('input', { type: 'file', accept: 'image/*', class: 'hidden' });
  const sourceSel = h('select', { 'aria-label': 'Camera source' },
    h('option', { value: 'webcam', text: "This computer's camera" }),
    hasCamera && h('option', { value: 'ip', text: 'Classroom IP camera' }),
    h('option', { value: 'upload', text: 'Upload a photo' }));
  if (hasCamera) sourceSel.value = 'ip';

  let stream = null;
  let video = null;
  let uploaded = null;

  const setStatus = (t) => { status.textContent = t || ''; };

  function stopStream() {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  async function startWebcam() {
    stopStream();
    if (!navigator.mediaDevices?.getUserMedia) {
      stage.replaceChildren(h('div', { class: 'placeholder', text: 'Camera access needs https:// or localhost. Open the ERP over https, or use "Upload a photo".' }));
      return;
    }
    setStatus('Starting camera...');
    try {
      const deviceId = deviceSel.value;
      stream = await navigator.mediaDevices.getUserMedia({
        video: { ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'environment' }), width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
    } catch (err) {
      stage.replaceChildren(h('div', { class: 'placeholder', text: `Could not open the camera: ${err.message}. Allow camera access in the browser.` }));
      setStatus('');
      return;
    }
    video = h('video', { autoplay: true, muted: true, playsinline: true });
    video.srcObject = stream;
    stage.replaceChildren(video);
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    const current = stream.getVideoTracks()[0]?.getSettings().deviceId;
    deviceSel.replaceChildren(...devices.map((d, i) => h('option', { value: d.deviceId, text: d.label || `Camera ${i + 1}` })));
    if (current) deviceSel.value = current;
    deviceSel.classList.toggle('hidden', devices.length < 2);
    const s = stream.getVideoTracks()[0]?.getSettings();
    setStatus(s?.width ? `Camera on (${s.width} x ${s.height})` : 'Camera on');
  }

  async function grabIp() {
    const res = await fetch(`/api/camera/${classId}/snapshot`, { cache: 'no-store' });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Could not get a picture from the classroom camera');
    const bmp = await createImageBitmap(await res.blob());
    return toCanvas(bmp, bmp.width, bmp.height);
  }

  async function showIpPreview() {
    stage.replaceChildren(h('div', { class: 'placeholder', text: 'Getting a picture from the classroom camera...' }));
    try {
      const c = await grabIp();
      stage.replaceChildren(c);
      setStatus(`Classroom camera connected (${c.width} x ${c.height})`);
    } catch (err) {
      stage.replaceChildren(h('div', { class: 'placeholder', text: err.message }));
      setStatus('');
    }
  }

  async function onSource() {
    stopStream();
    video = null;
    uploaded = null;
    deviceSel.classList.add('hidden');
    fileInput.classList.toggle('hidden', sourceSel.value !== 'upload');
    setStatus('');
    if (sourceSel.value === 'webcam') await startWebcam();
    else if (sourceSel.value === 'ip') await showIpPreview();
    else stage.replaceChildren(h('div', { class: 'placeholder', text: 'Choose a photo of the class or student.' }));
  }

  sourceSel.addEventListener('change', onSource);
  deviceSel.addEventListener('change', startWebcam);
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      const bmp = await createImageBitmap(file);
      uploaded = toCanvas(bmp, bmp.width, bmp.height);
      stage.replaceChildren(uploaded);
      setStatus(`Photo loaded (${uploaded.width} x ${uploaded.height})`);
    } catch {
      toast('That file is not an image the browser can read', 'error');
    }
  });

  const el = h('div', null,
    h('div', { class: 'row cam-controls' }, sourceSel, deviceSel, fileInput),
    stage, status);

  // Start loading the models right away so the first capture is quick.
  loadModels().catch(() => toast('Could not load face recognition models', 'error'));
  setTimeout(onSource, 0);

  return {
    el,
    setStatus,
    // Returns the current frame as a canvas.
    async grab() {
      if (sourceSel.value === 'webcam') {
        if (!video || !video.videoWidth) throw new Error('The camera is not on yet');
        return toCanvas(video, video.videoWidth, video.videoHeight);
      }
      if (sourceSel.value === 'ip') {
        const c = await grabIp();
        stage.replaceChildren(c);
        return c;
      }
      if (!uploaded) throw new Error('Choose a photo first');
      return uploaded;
    },
    stop: stopStream,
  };
}
