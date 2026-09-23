const DB_NAME = 'site-survey-local';
const DB_VERSION = 1;
const MAX_IMAGE_EDGE = 1800;
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const homeView = $('#home-view');
const editorView = $('#editor-view');
const surveyList = $('#survey-list');
const itemList = $('#item-list');
const itemDialog = $('#item-dialog');
const markupDialog = $('#markup-dialog');
const itemForm = $('#item-form');
const markupCanvas = $('#markup-canvas');
const markupContext = markupCanvas.getContext('2d', { willReadFrequently: true });

let dbPromise;
let currentReport = null;
let editingItemId = null;
let draftPhoto = null;
let draftMarked = false;
let previewUrl = null;
let saveTimer = null;
let saving = false;
let installPrompt = null;
let itemPhotoUrls = [];
let printPhotoUrls = [];
let markupOriginal = null;
let markupColor = '#e34f36';
let markupUndo = [];
let drawing = false;

function openDatabase() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('reports')) db.createObjectStore('reports', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open local survey storage.'));
  });
  return dbPromise;
}

async function storeReport(report) {
  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('reports', 'readwrite');
    tx.objectStore('reports').put(report);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error('Could not save this survey.'));
    tx.onabort = () => reject(tx.error || new Error('Survey saving was interrupted.'));
  });
}

async function readReports() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction('reports', 'readonly').objectStore('reports').getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error || new Error('Could not read saved surveys.'));
  });
}

async function removeReport(id) {
  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('reports', 'readwrite');
    tx.objectStore('reports').delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error('Could not delete this survey.'));
  });
}

function todayString() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function makeId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function prettyDate(value, options = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!value) return 'Not set';
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return 'Not set';
  return new Intl.DateTimeFormat(undefined, options).format(new Date(year, month - 1, day));
}

function esc(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function reportTitle(report) {
  return report.site?.trim() || 'Untitled survey';
}

function setSaveLabel(label, status = '') {
  const indicator = $('#save-indicator');
  if (!indicator) return;
  indicator.classList.toggle('save-error', status === 'error');
  indicator.querySelector('span:last-child').textContent = label;
}

function showHome() {
  clearTimeout(saveTimer);
  homeView.hidden = false;
  editorView.hidden = true;
  currentReport = null;
  renderSurveyList();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function renderSurveyList() {
  surveyList.replaceChildren();
  try {
    const reports = (await readReports()).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    $('#survey-count').textContent = reports.length ? `${reports.length} saved` : '';
    if (!reports.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-card';
      empty.innerHTML = 'No surveys yet. Start one above and it will show up here.';
      surveyList.append(empty);
      return;
    }
    for (const report of reports) {
      const card = document.createElement('article');
      card.className = 'survey-card';
      const open = document.createElement('button');
      open.className = 'survey-open';
      open.type = 'button';
      open.setAttribute('aria-label', `Open ${reportTitle(report)}`);
      open.innerHTML = `<div class="survey-card-top"><div><h3>${esc(reportTitle(report))}</h3><span class="survey-meta">${esc(report.surveyor?.trim() || 'Surveyor not added')}</span></div><span aria-hidden="true" class="card-arrow">↗</span></div>`;
      open.addEventListener('click', () => openSurvey(report.id));
      const foot = document.createElement('div');
      foot.className = 'survey-card-foot';
      foot.innerHTML = `<span class="survey-date">${esc(prettyDate(report.date))}</span><span class="item-count-pill">${(report.items || []).length} ${(report.items || []).length === 1 ? 'item' : 'items'}</span>`;
      card.append(open, foot);
      surveyList.append(card);
    }
  } catch (error) {
    surveyList.innerHTML = '<div class="empty-card">Local storage is unavailable in this browser.</div>';
    console.error(error);
  }
}

async function startSurvey() {
  currentReport = { id: makeId(), date: todayString(), site: '', surveyor: '', updatedAt: new Date().toISOString(), items: [] };
  try {
    await storeReport(currentReport);
    openEditor();
  } catch (error) {
    alert('This browser could not save a new survey. Check that local storage is available, then try again.');
    console.error(error);
  }
}

async function openSurvey(id) {
  try {
    const reports = await readReports();
    currentReport = reports.find((report) => report.id === id) || null;
    if (!currentReport) return showHome();
    currentReport.items ||= [];
    openEditor();
  } catch (error) {
    alert('Could not open this survey in local storage.');
    console.error(error);
  }
}

function openEditor() {
  homeView.hidden = true;
  editorView.hidden = false;
  $('#survey-date').value = currentReport.date || todayString();
  $('#survey-site').value = currentReport.site || '';
  $('#surveyor-name').value = currentReport.surveyor || '';
  setSaveLabel('Saved on this device');
  renderItems();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function syncReportFields() {
  if (!currentReport) return;
  currentReport.date = $('#survey-date').value || todayString();
  currentReport.site = $('#survey-site').value.trim();
  currentReport.surveyor = $('#surveyor-name').value.trim();
}

function scheduleSave() {
  if (!currentReport) return;
  syncReportFields();
  currentReport.updatedAt = new Date().toISOString();
  setSaveLabel('Saving…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    if (saving) return scheduleSave();
    saving = true;
    try {
      await storeReport(currentReport);
      setSaveLabel('Saved on this device');
      renderSurveyList();
    } catch (error) {
      setSaveLabel('Could not save', 'error');
      console.error(error);
    } finally {
      saving = false;
    }
  }, 350);
}

async function saveImmediately() {
  clearTimeout(saveTimer);
  if (!currentReport) return;
  syncReportFields();
  currentReport.updatedAt = new Date().toISOString();
  try {
    await storeReport(currentReport);
    setSaveLabel('Saved on this device');
    renderSurveyList();
  } catch (error) {
    setSaveLabel('Could not save', 'error');
    console.error(error);
  }
}

function clearItemUrls() {
  for (const url of itemPhotoUrls) URL.revokeObjectURL(url);
  itemPhotoUrls = [];
}

function renderItems() {
  clearItemUrls();
  itemList.replaceChildren();
  const items = currentReport?.items || [];
  $('#item-total').textContent = `${items.length} ${items.length === 1 ? 'item' : 'items'}`;
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'items-empty';
    empty.innerHTML = '<strong>Nothing added yet</strong>When you spot something, add a photo and a short note.';
    itemList.append(empty);
    return;
  }
  items.forEach((item, index) => {
    const card = document.createElement('article');
    card.className = 'item-card';
    const thumb = item.photo ? document.createElement('img') : document.createElement('div');
    if (item.photo) {
      const url = URL.createObjectURL(item.photo);
      itemPhotoUrls.push(url);
      thumb.src = url;
      thumb.alt = item.area ? `Photo: ${item.area}` : 'Survey item photo';
      thumb.className = 'item-thumb';
    } else {
      thumb.className = 'item-thumb item-thumb-empty';
      thumb.textContent = '＋';
      thumb.setAttribute('aria-label', 'No photo added');
    }
    const copy = document.createElement('div');
    copy.className = 'item-copy';
    const title = item.area?.trim() || `Item ${String(index + 1).padStart(2, '0')}`;
    const note = item.notes?.trim() || 'No observation added yet.';
    const chips = [];
    const owner = item.actionBy === 'Other' ? item.actionOther : item.actionBy;
    if (owner) chips.push(`<span class="item-chip">↗ ${esc(owner)}</span>`);
    if (item.dueDate) chips.push(`<span class="item-chip due-chip">By ${esc(prettyDate(item.dueDate))}</span>`);
    if (item.markedUp) chips.push('<span class="item-chip">Marked photo</span>');
    copy.innerHTML = `<div class="item-kicker">ITEM ${String(index + 1).padStart(2, '0')}</div><h3>${esc(title)}</h3><p class="item-notes">${esc(note)}</p><div class="item-chips">${chips.join('')}</div>`;
    const actions = document.createElement('div');
    actions.className = 'item-actions';
    const edit = document.createElement('button');
    edit.className = 'small-action';
    edit.type = 'button';
    edit.textContent = 'Edit item';
    edit.addEventListener('click', () => openItemDialog(item.id));
    const del = document.createElement('button');
    del.className = 'small-delete';
    del.type = 'button';
    del.setAttribute('aria-label', `Delete ${title}`);
    del.textContent = '×';
    del.addEventListener('click', () => deleteItem(item.id));
    actions.append(edit, del);
    card.append(thumb, copy, actions);
    itemList.append(card);
  });
}

function openItemDialog(id = null) {
  editingItemId = id;
  const item = id ? currentReport.items.find((entry) => entry.id === id) : null;
  draftPhoto = item?.photo || null;
  draftMarked = !!item?.markedUp;
  $('#item-dialog-title').textContent = item ? 'Edit this item' : 'Add an item';
  $('#item-area').value = item?.area || '';
  $('#item-notes').value = item?.notes || '';
  $('#item-action').value = item?.actionBy || '';
  $('#item-action-other').value = item?.actionOther || '';
  $('#item-due').value = item?.dueDate || '';
  $('#other-action-field').hidden = $('#item-action').value !== 'Other';
  $('#remove-item').hidden = !item;
  $('#camera-input').value = '';
  $('#library-input').value = '';
  showPhotoPreview();
  itemDialog.showModal();
}

function closeItemDialog() {
  itemDialog.close();
  editingItemId = null;
  draftPhoto = null;
  draftMarked = false;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
}

function showPhotoPreview() {
  const image = $('#draft-preview');
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = draftPhoto ? URL.createObjectURL(draftPhoto) : null;
  image.hidden = !previewUrl;
  $('#photo-empty').hidden = !!previewUrl;
  $('#annotate-photo').hidden = !previewUrl;
  if (previewUrl) image.src = previewUrl;
  $('#annotate-photo').textContent = draftMarked ? 'Edit markup' : 'Mark up';
}

async function compressPhoto(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('This photo could not be prepared.')), 'image/jpeg', .84));
}

async function handlePhoto(file) {
  if (!file) return;
  try {
    draftPhoto = await compressPhoto(file);
    draftMarked = false;
    showPhotoPreview();
  } catch (error) {
    alert('This photo could not be opened. Please choose a different image.');
    console.error(error);
  }
}

async function openMarkup() {
  if (!draftPhoto) return;
  try {
    markupOriginal?.close?.();
    markupOriginal = await createImageBitmap(draftPhoto);
    markupCanvas.width = markupOriginal.width;
    markupCanvas.height = markupOriginal.height;
    markupContext.clearRect(0, 0, markupCanvas.width, markupCanvas.height);
    markupContext.drawImage(markupOriginal, 0, 0);
    markupUndo = [];
    markupDialog.showModal();
  } catch (error) {
    alert('This photo could not be opened for markup.');
    console.error(error);
  }
}

function pushUndo() {
  try {
    markupUndo.push(markupContext.getImageData(0, 0, markupCanvas.width, markupCanvas.height));
    if (markupUndo.length > 7) markupUndo.shift();
  } catch (error) {
    console.warn('Undo history is unavailable for this photo.', error);
  }
}

function canvasPoint(event) {
  const rect = markupCanvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) * markupCanvas.width / rect.width, y: (event.clientY - rect.top) * markupCanvas.height / rect.height };
}

function startDrawing(event) {
  if (!markupCanvas.width) return;
  event.preventDefault();
  drawing = true;
  pushUndo();
  markupCanvas.setPointerCapture?.(event.pointerId);
  const point = canvasPoint(event);
  markupContext.beginPath();
  markupContext.moveTo(point.x, point.y);
  markupContext.lineCap = 'round';
  markupContext.lineJoin = 'round';
  markupContext.lineWidth = Math.max(7, markupCanvas.width / 75);
  markupContext.strokeStyle = markupColor;
  markupContext.globalAlpha = markupColor === '#ffd34e' ? .72 : .95;
  markupContext.lineTo(point.x + .1, point.y + .1);
  markupContext.stroke();
}

function continueDrawing(event) {
  if (!drawing) return;
  event.preventDefault();
  const point = canvasPoint(event);
  markupContext.lineTo(point.x, point.y);
  markupContext.stroke();
}

function endDrawing() {
  if (!drawing) return;
  drawing = false;
  markupContext.closePath();
  markupContext.globalAlpha = 1;
}

function saveMarkup() {
  markupCanvas.toBlob((blob) => {
    if (!blob) return alert('Could not save the markup. Please try again.');
    draftPhoto = blob;
    draftMarked = true;
    markupDialog.close();
    markupOriginal?.close?.();
    markupOriginal = null;
    showPhotoPreview();
  }, 'image/jpeg', .9);
}

async function saveItem(event) {
  event.preventDefault();
  if (!currentReport) return;
  const item = {
    id: editingItemId || makeId(),
    photo: draftPhoto,
    markedUp: draftMarked,
    area: $('#item-area').value.trim(),
    notes: $('#item-notes').value.trim(),
    actionBy: $('#item-action').value,
    actionOther: $('#item-action-other').value.trim(),
    dueDate: $('#item-due').value,
    updatedAt: new Date().toISOString(),
  };
  const index = currentReport.items.findIndex((entry) => entry.id === item.id);
  if (index >= 0) currentReport.items[index] = item;
  else currentReport.items.push(item);
  closeItemDialog();
  renderItems();
  await saveImmediately();
}

async function deleteItem(id) {
  const item = currentReport?.items.find((entry) => entry.id === id);
  if (!item || !confirm('Delete this survey item?')) return;
  currentReport.items = currentReport.items.filter((entry) => entry.id !== id);
  renderItems();
  await saveImmediately();
}

async function deleteSurvey() {
  if (!currentReport || !confirm(`Delete the survey for “${reportTitle(currentReport)}” and all its items? This cannot be undone.`)) return;
  try {
    await removeReport(currentReport.id);
    showHome();
  } catch (error) {
    alert('Could not delete this survey.');
    console.error(error);
  }
}

function currentOwner(item) {
  return item.actionBy === 'Other' ? item.actionOther?.trim() || 'Other' : item.actionBy?.trim() || 'Not assigned';
}

function buildPrintReport() {
  if (!currentReport) return;
  syncReportFields();
  const root = $('#print-report');
  root.replaceChildren();
  const items = currentReport.items || [];
  const groups = [];
  if (!items.length) groups.push([]);
  for (let i = 0; i < items.length; i += 2) groups.push(items.slice(i, i + 2));
  groups.forEach((group, pageIndex) => {
    const page = document.createElement('section');
    page.className = `print-page${pageIndex === 0 ? ' first-print-page' : ''}`;
    const head = document.createElement('header');
    head.className = 'print-head';
    head.innerHTML = `<div><div class="print-brand">SITE SURVEY · FIELD REPORT</div><h1>Site survey</h1><div class="print-site">${esc(reportTitle(currentReport))}</div><div class="print-sub">Surveyor: ${esc(currentReport.surveyor?.trim() || 'Not recorded')} &nbsp;·&nbsp; Survey date: ${esc(prettyDate(currentReport.date))}</div></div><div class="print-page-meta">${items.length} ${items.length === 1 ? 'item' : 'items'}<br />Page ${pageIndex + 1} of ${groups.length}</div>`;
    page.append(head);
    group.forEach((item, index) => {
      const absoluteIndex = pageIndex * 2 + index;
      const row = document.createElement('article');
      row.className = 'print-item';
      const photo = document.createElement('div');
      photo.className = 'print-photo';
      photo.innerHTML = `<span class="print-number">ITEM ${String(absoluteIndex + 1).padStart(2, '0')}</span>`;
      if (item.photo) {
        const image = document.createElement('img');
        const url = URL.createObjectURL(item.photo);
        printPhotoUrls.push(url);
        image.src = url;
        image.alt = `Photo for item ${absoluteIndex + 1}`;
        photo.append(image);
      } else {
        const placeholder = document.createElement('div');
        placeholder.className = 'print-photo-empty';
        placeholder.textContent = 'No photo attached';
        photo.append(placeholder);
      }
      const writeup = document.createElement('div');
      writeup.className = 'print-writeup';
      writeup.innerHTML = `<div class="print-item-kicker">OBSERVATION &amp; COMMENTS</div><h2 class="print-area">${esc(item.area?.trim() || `Item ${String(absoluteIndex + 1).padStart(2, '0')}`)}</h2><p class="print-notes">${esc(item.notes?.trim() || 'No observation added.')}</p><div class="print-assignment"><div><span>Action owner</span><strong>${esc(currentOwner(item))}</strong></div><div><span>Action by</span><strong>${esc(prettyDate(item.dueDate))}</strong></div></div>`;
      row.append(photo, writeup);
      page.append(row);
    });
    while (group.length && page.querySelectorAll('.print-item').length < 2) {
      const placeholder = document.createElement('div');
      placeholder.className = 'print-item print-empty';
      placeholder.textContent = 'Space for the next site item';
      page.append(placeholder);
    }
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'print-item print-empty';
      empty.textContent = 'No items have been recorded in this survey yet.';
      page.append(empty);
    }
    const footer = document.createElement('footer');
    footer.className = 'print-footer';
    footer.innerHTML = `<span>${esc(reportTitle(currentReport))}</span><span>Created with Site Survey</span>`;
    page.append(footer);
    root.append(page);
  });
}

function waitForPrintImages() {
  const images = [...$('#print-report').querySelectorAll('img')];
  return Promise.all(images.map((image) => image.decode?.().catch(() => {}) || Promise.resolve()));
}

async function exportPdf() {
  await saveImmediately();
  buildPrintReport();
  await waitForPrintImages();
  window.print();
}

$('#new-survey-top').addEventListener('click', startSurvey);
$('#new-survey-hero').addEventListener('click', startSurvey);
$('#brand-home').addEventListener('click', () => currentReport ? showHome() : renderSurveyList());
$('#back-home').addEventListener('click', async () => { await saveImmediately(); showHome(); });
$('#add-item').addEventListener('click', () => openItemDialog());
$('#delete-survey').addEventListener('click', deleteSurvey);
$('#export-pdf').addEventListener('click', exportPdf);
['survey-date', 'survey-site', 'surveyor-name'].forEach((id) => $(`#${id}`).addEventListener('input', scheduleSave));
['survey-date'].forEach((id) => $(`#${id}`).addEventListener('change', scheduleSave));
$('#close-item-dialog').addEventListener('click', closeItemDialog);
$('#cancel-item').addEventListener('click', closeItemDialog);
itemDialog.addEventListener('click', (event) => { if (event.target === itemDialog) closeItemDialog(); });
itemForm.addEventListener('submit', saveItem);
$('#item-action').addEventListener('change', () => { $('#other-action-field').hidden = $('#item-action').value !== 'Other'; });
$('#take-photo').addEventListener('click', () => $('#camera-input').click());
$('#choose-photo').addEventListener('click', () => $('#library-input').click());
$('#camera-input').addEventListener('change', (event) => handlePhoto(event.target.files?.[0]));
$('#library-input').addEventListener('change', (event) => handlePhoto(event.target.files?.[0]));
$('#annotate-photo').addEventListener('click', openMarkup);
$('#remove-item').addEventListener('click', async () => { const id = editingItemId; closeItemDialog(); if (id) await deleteItem(id); });
$('#close-markup').addEventListener('click', () => markupDialog.close());
$('#cancel-markup').addEventListener('click', () => markupDialog.close());
$('#save-markup').addEventListener('click', saveMarkup);
$('#undo-mark').addEventListener('click', () => { const image = markupUndo.pop(); if (image) markupContext.putImageData(image, 0, 0); });
$('#clear-marks').addEventListener('click', () => { if (!markupOriginal) return; pushUndo(); markupContext.clearRect(0, 0, markupCanvas.width, markupCanvas.height); markupContext.drawImage(markupOriginal, 0, 0); });
$$('.color-swatch').forEach((button) => button.addEventListener('click', () => {
  $$('.color-swatch').forEach((swatch) => swatch.classList.remove('selected'));
  button.classList.add('selected');
  markupColor = button.dataset.color;
}));
markupCanvas.addEventListener('pointerdown', startDrawing);
markupCanvas.addEventListener('pointermove', continueDrawing);
markupCanvas.addEventListener('pointerup', endDrawing);
markupCanvas.addEventListener('pointercancel', endDrawing);
window.addEventListener('afterprint', () => {
  $('#print-report').replaceChildren();
  for (const url of printPhotoUrls) URL.revokeObjectURL(url);
  printPhotoUrls = [];
});
window.addEventListener('beforeunload', () => { if (currentReport) { clearTimeout(saveTimer); syncReportFields(); storeReport(currentReport); } });

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
  $('#install-button').hidden = false;
});
$('#install-button').addEventListener('click', async () => {
  if (!installPrompt) return;
  await installPrompt.prompt();
  installPrompt = null;
  $('#install-button').hidden = true;
});

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch((error) => console.warn('Offline support could not start.', error)));
}

renderSurveyList();
