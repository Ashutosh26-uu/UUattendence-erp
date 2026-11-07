// Camera + face detection in the browser (face-api.js on TensorFlow.js). Each detected face
// becomes a 128-number descriptor; only those numbers go to the server, never the video.
import * as faceapi from '/vendor/face-api/face-api.esm.js';
import { h, toast } from './common.js';

const MAX_SIDE = 2560; // bigger frames find back-row faces but run slower

let ready = null;
export function loadModels() {
  if (!ready) {
    ready = (async () => {
      try { await faceapi.tf.setBackend('webgl'); } catch { /* cpu fallback */ }
      await faceapi.tf.ready();
      await Promise.all([
        faceapi.nets.ssdMobilenetv1.loadFromUri('/models'),
        faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
        faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
      ]);
    })();
    ready.catch(() => { ready = null; });
  }
  return ready;
}

export async function detectFaces(canvas, minConfidence = 0.5) {
  await loadModels();
  const found = await faceapi.detectAllFaces(canvas, new faceapi.SsdMobilenetv1Options({ minConfidence, maxResults: 300 })).withFaceLandmarks().withFaceDescriptors();
  return found.map((r) => ({
    box: { x: r.detection.box.x, y: r.detection.box.y, width: r.detection.box.width, height: r.detection.box.height },
    descriptor: Array.from(r.descriptor),
  })).sort((a, b) => a.box.x - b.box.x);
}

export function cropFace(canvas, box, size = 160) {
  const side = Math.max(box.width, box.height) * 1.5;
  const out = document.createElement('canvas');
  out.width = size;
  out.height = size;
  out.getContext('2d').drawImage(canvas, Math.max(0, box.x + box.width / 2 - side / 2), Math.max(0, box.y + box.height / 2 - side / 2), side, side, 0, 0, size, size);
  return out.toDataURL('image/jpeg', 0.85);
}

export function toCanvas(source, w, hh) {
  const scale = Math.min(1, MAX_SIDE / Math.max(w, hh));
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(hh * scale);
  c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
  return c;
}

export async function fileToCanvas(file) {
  const bmp = await createImageBitmap(file);
  return toCanvas(bmp, bmp.width, bmp.height);
}

// Boxes over the stage: green = recognised (with roll no), amber = not recognised.
export function drawOverlay(overlay, frameW, frameH, faces, labels) {
  const rect = overlay.getBoundingClientRect();
  overlay.width = rect.width * devicePixelRatio;
  overlay.height = rect.height * devicePixelRatio;
  const ctx = overlay.getContext('2d');
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  // object-fit: contain mapping
  const scale = Math.min(overlay.width / frameW, overlay.height / frameH);
  const ox = (overlay.width - frameW * scale) / 2;
  const oy = (overlay.height - frameH * scale) / 2;
  const font = Math.max(11, 13 * devicePixelRatio);
  ctx.font = `600 ${font}px Segoe UI, sans-serif`;
  ctx.lineWidth = 2.5 * devicePixelRatio;
  faces.forEach((f, i) => {
    const l = labels[i];
    const color = l ? '#2ecc71' : '#f5a623';
    const x = ox + f.box.x * scale;
    const y = oy + f.box.y * scale;
    ctx.strokeStyle = color;
    ctx.strokeRect(x, y, f.box.width * scale, f.box.height * scale);
    if (l) {
      const tw = ctx.measureText(l).width + 8;
      ctx.fillStyle = color;
      ctx.fillRect(x, Math.max(0, y - font - 6), tw, font + 6);
      ctx.fillStyle = '#08130c';
      ctx.fillText(l, x + 4, Math.max(font, y - 4));
    }
  });
}

// Source picker + live preview.
//   room   : classroom IP camera, fetched through the server (needs roomSnapshotUrl)
//   device : this computer's camera (laptop / USB camera plugged into the classroom PC)
//   upload : a photo, as a fallback
export function cameraPanel({ roomSnapshotUrl = null, allowUpload = true } = {}) {
  const frameCanvas = h('canvas', { class: 'frame' });
  const overlay = h('canvas', { class: 'overlay' });
  const live = h('span', { class: 'live hidden', text: 'LIVE' });
  const stage = h('div', { class: 'camera-stage' }, h('div', { class: 'placeholder', text: 'Choose a camera' }));
  const status = h('div', { class: 'small muted' });
  const deviceSel = h('select', { class: 'hidden', 'aria-label': 'Camera device' });
  const fileInput = h('input', { type: 'file', accept: 'image/*', class: 'hidden', 'aria-label': 'Photo' });
  const sourceSel = h('select', { 'aria-label': 'Camera source' },
    roomSnapshotUrl && h('option', { value: 'room', text: 'Classroom camera' }),
    h('option', { value: 'device', text: "This computer's camera" }),
    allowUpload && h('option', { value: 'upload', text: 'Upload a photo' }));
  let stream = null;
  let video = null;
  let still = null;

  const setStatus = (t) => { status.textContent = t || ''; };
  const stopStream = () => { stream?.getTracks().forEach((t) => t.stop()); stream = null; };
  const showStill = (c) => {
    still = c;
    frameCanvas.width = c.width;
    frameCanvas.height = c.height;
    frameCanvas.getContext('2d').drawImage(c, 0, 0);
    stage.replaceChildren(frameCanvas, overlay, live);
  };

  async function startDevice() {
    stopStream();
    if (!navigator.mediaDevices?.getUserMedia) {
      stage.replaceChildren(h('div', { class: 'placeholder', text: 'Camera needs https:// (or localhost). Ask IT to open the ERP over https.' }));
      return;
    }
    setStatus('Starting camera...');
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { ...(deviceSel.value ? { deviceId: { exact: deviceSel.value } } : {}), width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false,
      });
    } catch (err) {
      stage.replaceChildren(h('div', { class: 'placeholder', text: `Could not open the camera (${err.message}). Allow camera access in the browser.` }));
      setStatus('');
      return;
    }
    video = h('video', { autoplay: true, muted: true, playsinline: true });
    video.srcObject = stream;
    stage.replaceChildren(video, overlay, live);
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    const cur = stream.getVideoTracks()[0]?.getSettings();
    deviceSel.replaceChildren(...devices.map((d, i) => h('option', { value: d.deviceId, text: d.label || `Camera ${i + 1}` })));
    if (cur?.deviceId) deviceSel.value = cur.deviceId;
    deviceSel.classList.toggle('hidden', devices.length < 2);
    setStatus(cur?.width ? `Camera on · ${cur.width} x ${cur.height}` : 'Camera on');
  }

  async function grabRoom() {
    const res = await fetch(roomSnapshotUrl, { cache: 'no-store' });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Could not get a picture from the classroom camera');
    const bmp = await createImageBitmap(await res.blob());
    return toCanvas(bmp, bmp.width, bmp.height);
  }

  async function onSource() {
    stopStream();
    video = null;
    still = null;
    deviceSel.classList.add('hidden');
    fileInput.classList.toggle('hidden', sourceSel.value !== 'upload');
    setStatus('');
    if (sourceSel.value === 'device') await startDevice();
    else if (sourceSel.value === 'room') {
      stage.replaceChildren(h('div', { class: 'placeholder', text: 'Connecting to the classroom camera...' }));
      try { const c = await grabRoom(); showStill(c); setStatus(`Classroom camera connected · ${c.width} x ${c.height}`); } catch (err) {
        stage.replaceChildren(h('div', { class: 'placeholder', text: err.message }));
      }
    } else stage.replaceChildren(h('div', { class: 'placeholder', text: 'Choose a photo.' }));
  }

  sourceSel.addEventListener('change', onSource);
  deviceSel.addEventListener('change', startDevice);
  fileInput.addEventListener('change', async () => {
    if (!fileInput.files[0]) return;
    try { const c = await fileToCanvas(fileInput.files[0]); showStill(c); setStatus(`Photo loaded · ${c.width} x ${c.height}`); } catch { toast('That file is not an image the browser can read', 'error'); }
  });

  loadModels().catch(() => toast('Could not load the face recognition models', 'error'));
  setTimeout(onSource, 0);

  return {
    el: h('div', null, h('div', { class: 'row cam-controls' }, sourceSel, deviceSel, fileInput), stage, status),
    setStatus,
    setLive: (on) => live.classList.toggle('hidden', !on),
    // Current frame as a canvas (the classroom camera is re-fetched each time).
    async grab() {
      if (sourceSel.value === 'device') {
        if (!video?.videoWidth) throw new Error('The camera is not on yet');
        return toCanvas(video, video.videoWidth, video.videoHeight);
      }
      if (sourceSel.value === 'room') { const c = await grabRoom(); showStill(c); return c; }
      if (!still) throw new Error('Choose a photo first');
      return still;
    },
    overlay,
    stop: stopStream,
  };
}
