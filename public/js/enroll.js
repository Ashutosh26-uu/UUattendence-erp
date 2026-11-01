// Face enrollment: photograph the class once (group photo or one student at a time),
// pick the right name for each detected face, and save it as that student's reference photo.
import { h, api, toast, busy, confirmBox, selectEl } from './common.js';

export function enrollView(classesUrl) {
  return async (main, ctx) => {
    // face-api.js is large, so it loads only when this screen is opened.
    const { cameraPanel, detectFaces, cropFace, drawResult } = await import('./camera.js');
    const classes = await api(classesUrl);
    if (!classes.length) {
      main.append(h('div', { class: 'card empty', text: 'No classes yet.' }));
      return;
    }
    main.append(h('p', { class: 'muted', text: 'Do this once per class. Take a group photo with the classroom camera (or photograph students one at a time), choose the right name under every face and save. 2-3 photos per student (front, slightly left, slightly right) give the best accuracy.' }));
    const body = h('div');
    const classSel = selectEl(classes.map((c) => ({ value: c.id, label: c.name })), { placeholder: 'Choose a class', onchange: () => load() });
    main.append(h('div', { class: 'card row' }, h('strong', { text: 'Class' }), classSel), body);

    let panel = null;
    ctx.cleanup = () => panel?.stop();
    if (classes.length === 1) { classSel.value = String(classes[0].id); load(); }

    async function load() {
      panel?.stop();
      body.replaceChildren();
      const cls = classes.find((c) => String(c.id) === classSel.value);
      if (!cls) return;
      let students = await api(`/api/faces/class/${cls.id}`);

      panel = cameraPanel({ classId: cls.id, hasCamera: !!(cls.has_camera || cls.camera_url) });
      const resultCanvas = h('canvas', { class: 'result-canvas hidden' });
      const faceGrid = h('div', { class: 'face-grid' });
      const listBox = h('div');
      const summary = h('div', { class: 'stats' });

      const captureBtn = h('button', { class: 'primary big', text: 'Capture and find faces' });
      captureBtn.addEventListener('click', busy(async () => {
        const frame = await panel.grab();
        panel.setStatus('Finding faces...');
        const faces = await detectFaces(frame, ctx.me.min_face_confidence);
        drawResult(resultCanvas, frame, faces, faces.map((f, i) => ({ text: `Face ${i + 1}`, kind: 'warn' })));
        resultCanvas.classList.remove('hidden');
        panel.setStatus(faces.length ? `Found ${faces.length} face(s). Choose a name under each face and save.` : 'No face found. Move closer to the camera, improve the light, or try again.');
        faceGrid.replaceChildren(...faces.map((f, i) => faceCard(frame, f, i)));
      }));

      function studentOptions() {
        return students.map((s) => ({ value: s.id, label: `${s.roll_no} - ${s.name}${s.samples.length ? ` (${s.samples.length} photo${s.samples.length > 1 ? 's' : ''})` : ''}` }));
      }

      function faceCard(frame, face, i) {
        const photo = cropFace(frame, face.box);
        const sel = selectEl(studentOptions(), { placeholder: 'Who is this?' });
        const card = h('div', { class: 'face-card' }, h('img', { src: photo, alt: `Face ${i + 1}` }), h('div', { class: 'small muted', text: `Face ${i + 1}` }), sel);
        const save = h('button', { class: 'primary sm', text: 'Save' });
        save.addEventListener('click', busy(async () => {
          if (!sel.value) throw new Error('Choose the student first');
          const payload = { descriptor: face.descriptor, photo };
          try {
            await api(`/api/faces/students/${sel.value}`, { method: 'POST', body: payload });
          } catch (err) {
            if (err.status !== 409) throw err;
            if (!await confirmBox(`${err.message}\n\nSave it for the chosen student anyway?`, { ok: 'Save anyway', danger: true })) return;
            await api(`/api/faces/students/${sel.value}`, { method: 'POST', body: { ...payload, force: true } });
          }
          card.classList.add('saved');
          sel.disabled = true;
          save.replaceWith(h('span', { class: 'badge ok', text: 'Saved' }));
          toast('Face saved');
          await refresh();
        }));
        card.append(save);
        return card;
      }

      async function refresh() {
        students = await api(`/api/faces/class/${cls.id}`);
        renderList();
      }

      function renderList() {
        const enrolled = students.filter((s) => s.samples.length).length;
        summary.replaceChildren(
          h('div', { class: 'stat' }, h('div', { class: 'label', text: 'Students in class' }), h('div', { class: 'value', text: students.length })),
          h('div', { class: `stat ${enrolled === students.length ? 'ok' : 'warn'}` }, h('div', { class: 'label', text: 'Face enrolled' }), h('div', { class: 'value', text: enrolled })),
          h('div', { class: 'stat' }, h('div', { class: 'label', text: 'Not enrolled' }), h('div', { class: 'value', text: students.length - enrolled })));
        listBox.replaceChildren(students.length ? h('div', { class: 'table-wrap' }, h('table', null,
          h('thead', null, h('tr', null, ['Roll no', 'Name', 'Photos', ''].map((t) => h('th', { text: t })))),
          h('tbody', null, students.map((s) => h('tr', null,
            h('td', { text: s.roll_no }), h('td', { text: s.name }),
            h('td', null, s.samples.length ? h('div', { class: 'thumbs' }, s.samples.map((f) => h('div', { class: 'thumb' },
              h('img', { src: f.photo || '', alt: `${s.name} photo` }),
              h('button', {
                class: 'danger', text: 'x', title: 'Delete this photo', 'aria-label': `Delete photo of ${s.name}`,
                onclick: busy(async () => {
                  if (!await confirmBox(`Delete this photo of ${s.name}?`, { ok: 'Delete', danger: true })) return;
                  await api(`/api/faces/samples/${f.id}`, { method: 'DELETE' });
                  await refresh();
                }),
              })))) : h('span', { class: 'badge warn', text: 'Not enrolled' })),
            h('td', { class: 'num small muted', text: `${s.samples.length}/10` }))))))
          : h('div', { class: 'empty', text: 'No students in this class yet.' }));
      }

      renderList();
      body.append(
        summary,
        h('div', { class: 'grid2' },
          h('div', { class: 'card' }, h('h2', { text: 'Camera' }), panel.el, h('div', { class: 'row' }, captureBtn), resultCanvas,
            h('h3', { class: 'face-head', text: 'Faces found' }), faceGrid),
          h('div', { class: 'card' }, h('h2', { text: 'Students' }), listBox)));
    }
  };
}
