/* =============================================
   DiaCare – app.js
   Firebase Auth (Google) + Firestore database
   ============================================= */

// ────────────────────────────────────────────
//  Firebase Initialisation
// ────────────────────────────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyCurwb6lzHUGDtvss7XiJXD-4jvjo83o9c",
  authDomain:        "dia-care-26.firebaseapp.com",
  projectId:         "dia-care-26",
  storageBucket:     "dia-care-26.firebasestorage.app",
  messagingSenderId: "219192393598",
  appId:             "1:219192393598:web:13c866ea6101096479fd2f",
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.firestore();

// Enable Firestore offline persistence (works across reloads)
db.enablePersistence({ synchronizeTabs: true }).catch(err => {
  if (err.code === 'failed-precondition') {
    console.warn('Firestore persistence unavailable: multiple tabs open.');
  } else if (err.code === 'unimplemented') {
    console.warn('Firestore persistence not supported in this browser.');
  }
});

// ────────────────────────────────────────────
//  State
// ────────────────────────────────────────────
let currentUser     = null;
let currentRole     = null;
let unsubListeners  = [];
let chartObserver   = null; // IntersectionObserver for lazy chart render

function uid() { return currentUser?.uid ?? null; }
function col(name)     { return db.collection('users').doc(uid()).collection(name); }
function userDoc(name) { return db.collection('users').doc(uid()).collection('settings').doc(name); }

// ────────────────────────────────────────────
//  Performance helpers
// ────────────────────────────────────────────

/** Debounce: coalesces rapid calls (e.g. burst Firestore updates) */
function debounce(fn, ms = 60) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/** Schedule work on the next animation frame */
function rafRun(fn) {
  requestAnimationFrame(fn);
}

// ────────────────────────────────────────────
//  Realtime listener registry
// ────────────────────────────────────────────
function stopAllListeners() {
  unsubListeners.forEach(u => u());
  unsubListeners = [];
  // Disconnect chart intersection observer if any
  if (chartObserver) { chartObserver.disconnect(); chartObserver = null; }
}

function addListener(unsub) { unsubListeners.push(unsub); }

// ────────────────────────────────────────────
//  Toast system
// ────────────────────────────────────────────
function toast(msg, type = 'info') {
  let c = document.getElementById('toast-container');
  if (!c) {
    c = document.createElement('div');
    c.id = 'toast-container';
    document.body.appendChild(c);
  }
  const t = document.createElement('div');
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  t.className = `toast ${type}`;
  t.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${msg}</span>`;
  c.appendChild(t);
  setTimeout(() => {
    t.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => t.remove(), 320);
  }, 2800);
}

// ────────────────────────────────────────────
//  Chart instance registry
// ────────────────────────────────────────────
const charts = {};

function destroyChart(id) {
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
}

function renderBloodSugarChart(canvasId, records) {
  destroyChart(canvasId);

  if (!records || records.length === 0) {
    const el = document.getElementById(canvasId);
    const wrap = el ? el.closest('.chart-wrap') : document.querySelector('.chart-wrap');
    if (wrap) wrap.innerHTML = `<div class="chart-empty"><span class="empty-icon">📉</span><span>No blood sugar data yet.</span></div>`;
    return;
  }

  // Restore canvas if it was replaced by empty-state
  let cvs = document.getElementById(canvasId);
  if (!cvs || cvs.tagName !== 'CANVAS') {
    const wrap = document.querySelector('.chart-wrap');
    if (!wrap) return;
    wrap.innerHTML = `<canvas id="${canvasId}"></canvas>`;
    cvs = document.getElementById(canvasId);
  }

  // Use IntersectionObserver for lazy render — only render when visible
  if ('IntersectionObserver' in window) {
    if (chartObserver) chartObserver.disconnect();
    chartObserver = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        chartObserver.disconnect();
        chartObserver = null;
        _drawChart(cvs, canvasId, records);
      }
    }, { threshold: 0.1 });
    chartObserver.observe(cvs);
  } else {
    _drawChart(cvs, canvasId, records);
  }
}

function _drawChart(cvs, canvasId, records) {
  if (!cvs) return;
  const ctx = cvs.getContext('2d');
  charts[canvasId] = new Chart(ctx, {
    type: 'line',
    data: {
      labels: records.map(r => r.date + (r.time ? ' ' + r.time : '')),
      datasets: [{
        label: 'Blood Sugar (mg/dL)',
        data: records.map(r => r.value),
        borderColor: '#4fc3f7',
        backgroundColor: 'rgba(79,195,247,0.07)',
        pointBackgroundColor: '#4fc3f7',
        pointBorderColor: '#0d1117',
        pointRadius: 4,
        pointHoverRadius: 6,
        borderWidth: 2,
        fill: true,
        tension: 0.35,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400 },
      plugins: {
        legend: { labels: { color: '#8b949e', font: { family: 'Inter', size: 11 }, boxWidth: 12 } },
        tooltip: {
          backgroundColor: '#161b22',
          titleColor: '#e6edf3',
          bodyColor: '#8b949e',
          borderColor: 'rgba(255,255,255,0.07)',
          borderWidth: 1,
          callbacks: { label: ctx => ` ${ctx.parsed.y} mg/dL` },
        },
      },
      scales: {
        x: {
          ticks: { color: '#8b949e', font: { size: 9 }, maxTicksLimit: 6, maxRotation: 0 },
          grid: { color: 'rgba(255,255,255,0.04)' },
        },
        y: {
          ticks: { color: '#8b949e', font: { size: 9 } },
          grid: { color: 'rgba(255,255,255,0.04)' },
        },
      },
    },
  });
}

// ────────────────────────────────────────────
//  Utility
// ────────────────────────────────────────────
function todayDate() { return new Date().toISOString().slice(0, 10); }
function now24h()    { return new Date().toTimeString().slice(0, 5); }
function escHtml(s)  {
  if (!s) return '';
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function cutoffDate(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// ────────────────────────────────────────────
//  Screen helpers
// ────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  const t = document.getElementById(id);
  if (t) t.classList.remove('hidden');
}

function removeModalOverlay() {
  const o = document.getElementById('modal-overlay');
  if (o) o.remove();
}

// ────────────────────────────────────────────
//  Loading Splash
// ────────────────────────────────────────────
function showLoading(msg = 'Loading…') {
  let el = document.getElementById('loading-screen');
  if (!el) {
    el = document.createElement('div');
    el.id = 'loading-screen';
    document.body.appendChild(el);
  }
  el.innerHTML = `<div class="spinner"></div><p>${msg}</p>`;
  el.style.display = 'flex';
}

function hideLoading() {
  const el = document.getElementById('loading-screen');
  if (el) el.remove();
}

// ════════════════════════════════════════════
//  LOGIN SCREEN
// ════════════════════════════════════════════
function renderLoginScreen() {
  const app = document.getElementById('app');
  // Remove existing screens except login
  app.innerHTML = `
    <section id="login-screen" class="screen flex flex-col items-center justify-center">
      <div class="login-card">
        <div class="login-logo">🩺</div>
        <h1>DiaCare</h1>
        <p class="login-tagline">
          Your smart diabetes management companion.<br/>
          Sign in to access your health dashboard.
        </p>
        <button class="btn-google" id="btn-google-signin">
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google logo" />
          Continue with Google
        </button>
        <p id="login-error" class="error-msg hidden" style="margin-top:14px;text-align:center;"></p>
        <p class="login-note">
          Your health data is securely stored in the cloud and synced across all your devices.
          By signing in you agree to keep your credentials safe.
        </p>
      </div>
    </section>`;

  document.getElementById('btn-google-signin').addEventListener('click', signInWithGoogle);
}

async function signInWithGoogle() {
  const btn = document.getElementById('btn-google-signin');
  const errEl = document.getElementById('login-error');
  if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }
  if (errEl) errEl.classList.add('hidden');
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    await auth.signInWithPopup(provider);
    // onAuthStateChanged will handle the rest
  } catch (err) {
    console.error('Sign-in error:', err);
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google logo" /> Continue with Google`;
    }
    if (errEl) {
      errEl.textContent = err.message || 'Sign-in failed. Please try again.';
      errEl.classList.remove('hidden');
    }
  }
}

async function signOut() {
  stopAllListeners();
  destroyChart('bs-chart');
  currentRole = null;
  await auth.signOut();
  // onAuthStateChanged will redirect to login
}

// ════════════════════════════════════════════
//  ROLE SELECTION SCREEN
// ════════════════════════════════════════════
function renderRoleScreen() {
  const app = document.getElementById('app');
  const name  = currentUser?.displayName?.split(' ')[0] || 'there';
  const photo = currentUser?.photoURL;
  const initials = (currentUser?.displayName || 'U').charAt(0).toUpperCase();

  const avatarHtml = photo
    ? `<img src="${escHtml(photo)}" class="user-avatar" alt="avatar" />`
    : `<div class="user-avatar-placeholder">${initials}</div>`;

  app.innerHTML = `
    <section id="role-screen" class="screen flex flex-col items-center justify-center">
      <div class="role-header">
        <div class="logo-icon">🩺</div>
        <h1>DiaCare</h1>
        <p>Welcome back, <strong>${escHtml(name)}</strong>! Select your role to continue.</p>
      </div>
      <div class="role-cards">
        <div class="role-card" id="btn-patient" tabindex="0" role="button">
          <div class="role-icon patient">🧑‍🦯</div>
          <div class="role-info">
            <h3>Patient</h3>
            <p>View your health data, medicines &amp; reminders</p>
          </div>
          <span style="margin-left:auto;color:var(--txt-muted);font-size:20px;">›</span>
        </div>
        <div class="role-card" id="btn-caretaker" tabindex="0" role="button">
          <div class="role-icon caretaker">👩‍⚕️</div>
          <div class="role-info">
            <h3>Care Taker</h3>
            <p>Log food, snacks &amp; water intake for the patient</p>
          </div>
          <span style="margin-left:auto;color:var(--txt-muted);font-size:20px;">›</span>
        </div>
        <div class="role-card" id="btn-doctor" tabindex="0" role="button">
          <div class="role-icon doctor">🩻</div>
          <div class="role-info">
            <h3>Doctor</h3>
            <p>Full access – prescribe medicines, edit records</p>
          </div>
          <span style="margin-left:auto;color:var(--txt-muted);font-size:20px;">›</span>
        </div>
      </div>
      <!-- Sign out link at bottom -->
      <button id="btn-signout-role" style="margin-top:32px;background:transparent;border:none;color:var(--txt-muted);font-size:0.82rem;cursor:pointer;display:flex;align-items:center;gap:8px;">
        ${avatarHtml}
        <span>Signed in as ${escHtml(currentUser?.email || '')} &nbsp;·&nbsp; Sign out</span>
      </button>
    </section>`;

  document.getElementById('btn-patient').addEventListener('click', () => goDashboard('patient'));
  document.getElementById('btn-caretaker').addEventListener('click', () => goDashboard('caretaker'));
  document.getElementById('btn-doctor').addEventListener('click', () => showDoctorPinModal());
  document.getElementById('btn-signout-role').addEventListener('click', signOut);

  ['btn-patient','btn-caretaker','btn-doctor'].forEach(id => {
    document.getElementById(id).addEventListener('keypress', e => {
      if (e.key === 'Enter' || e.key === ' ') e.currentTarget.click();
    });
  });
}

// ════════════════════════════════════════════
//  DOCTOR PIN MODAL  (checks Firestore)
// ════════════════════════════════════════════
function showDoctorPinModal() {
  removeModalOverlay();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="pin-title">
      <h2 id="pin-title">🔐 Doctor Access</h2>
      <p class="modal-sub">Enter your unique Doctor PIN to access the dashboard.</p>
      <div class="input-group">
        <label for="doctor-pin-input">Doctor PIN</label>
        <input type="password" id="doctor-pin-input" placeholder="Enter PIN" maxlength="20" autocomplete="off" />
        <span class="error-msg hidden" id="pin-error">Incorrect PIN. Please try again.</span>
      </div>
      <p class="hint-text">Hint: Default PIN is <strong>1234</strong> if none has been set.</p>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="pin-cancel">Cancel</button>
        <button class="btn btn-primary" id="pin-submit">Access Dashboard</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const pinInput = document.getElementById('doctor-pin-input');
  pinInput.focus();

  document.getElementById('pin-cancel').addEventListener('click', removeModalOverlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) removeModalOverlay(); });

  async function attemptPin() {
    const pin = pinInput.value.trim();
    const submitBtn = document.getElementById('pin-submit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Checking…';

    try {
      const snap = await userDoc('doctorPin').get();
      const stored = snap.exists ? snap.data().pin : '1234';
      if (pin === stored) {
        removeModalOverlay();
        goDashboard('doctor');
      } else {
        document.getElementById('pin-error').classList.remove('hidden');
        pinInput.value = '';
        pinInput.focus();
        submitBtn.disabled = false;
        submitBtn.textContent = 'Access Dashboard';
      }
    } catch (err) {
      console.error(err);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Access Dashboard';
      toast('Error checking PIN. Try again.', 'error');
    }
  }

  document.getElementById('pin-submit').addEventListener('click', attemptPin);
  pinInput.addEventListener('keypress', e => { if (e.key === 'Enter') attemptPin(); });
}

// ════════════════════════════════════════════
//  GO TO DASHBOARD
// ════════════════════════════════════════════
function goDashboard(role) {
  currentRole = role;
  stopAllListeners();
  renderDashboard(role);
}

function goRoleSelection() {
  currentRole = null;
  stopAllListeners();
  destroyChart('bs-chart');
  renderRoleScreen();
}

// ════════════════════════════════════════════
//  DASHBOARD RENDERING
// ════════════════════════════════════════════
function renderDashboard(role) {
  const app = document.getElementById('app');
  app.innerHTML = '';  // clear

  const isDoctor    = role === 'doctor';
  const isCaretaker = role === 'caretaker';
  const roleLabel   = { patient: 'Patient', caretaker: 'Care Taker', doctor: 'Doctor' }[role];
  const photo       = currentUser?.photoURL;
  const initials    = (currentUser?.displayName || 'U').charAt(0).toUpperCase();
  const avatarHtml  = photo
    ? `<img src="${escHtml(photo)}" class="user-avatar" alt="avatar" />`
    : `<div class="user-avatar-placeholder">${initials}</div>`;

  const dashEl = document.createElement('section');
  dashEl.id = 'dashboard-screen';
  dashEl.className = 'screen dashboard';

  dashEl.innerHTML = `
    <nav class="topbar">
      <div class="topbar-brand">
        <div class="brand-dot"></div>
        <span class="brand-name">DiaCare</span>
      </div>
      <div class="topbar-right">
        <div class="user-info">
          ${avatarHtml}
          <span class="user-name">${escHtml(currentUser?.displayName || '')}</span>
        </div>
        <span class="role-badge ${role}">${roleLabel}</span>
        <button class="logout-btn" id="logout-btn">⏻ Logout</button>
      </div>
    </nav>

    <div class="dashboard-content">

      <!-- Blood Sugar -->
      <div class="card">
        <div class="card-header">
          <span class="card-title"><span class="icon">📊</span>
            ${isDoctor ? '3-Month' : '1-Month'} Blood Sugar Progress
          </span>
          ${isDoctor ? `<button class="btn btn-icon" id="btn-add-bs" title="Log Blood Sugar">＋</button>` : ''}
        </div>
        <div class="chart-wrap"><canvas id="bs-chart"></canvas></div>
        ${isDoctor ? `
        <div id="bs-form" style="display:none;flex-wrap:wrap;gap:8px;margin-top:12px;">
          <div class="input-group" style="flex:1;min-width:120px;margin-bottom:0">
            <input type="number" id="bs-value" placeholder="Value mg/dL" min="1" max="1000" />
          </div>
          <div class="input-group" style="width:130px;margin-bottom:0">
            <input type="text" id="bs-type" placeholder="Type (fasting…)" />
          </div>
          <button class="btn btn-primary btn-sm" id="btn-save-bs">Save</button>
        </div>` : ''}
      </div>

      <!-- Doctor PIN update (Doctor only) -->
      ${isDoctor ? `
      <div class="card">
        <div class="card-header">
          <span class="card-title"><span class="icon">🔐</span> Update Doctor PIN</span>
        </div>
        <p class="section-sub">Change your unique PIN used to access the doctor dashboard.</p>
        <div class="pin-section">
          <div class="input-group" style="flex:1;min-width:150px;margin-bottom:0">
            <input type="password" id="new-pin-input" placeholder="New PIN" maxlength="20" autocomplete="new-password" />
          </div>
          <div class="input-group" style="flex:1;min-width:150px;margin-bottom:0">
            <input type="password" id="confirm-pin-input" placeholder="Confirm PIN" maxlength="20" autocomplete="new-password" />
          </div>
          <button class="btn btn-primary btn-sm" id="btn-save-pin">Update PIN</button>
        </div>
        <span class="error-msg" id="pin-update-error" style="display:none;margin-top:8px;"></span>
      </div>` : ''}

      <!-- Medicines -->
      <div class="card">
        <div class="card-header">
          <span class="card-title"><span class="icon">💊</span> Medicines</span>
          ${isDoctor ? `<button class="btn btn-icon" id="btn-add-med" title="Add Medicine">＋</button>` : ''}
        </div>
        <div id="medicine-list-wrap"></div>
      </div>

      <!-- Food Plan -->
      <div class="card">
        <div class="card-header">
          <span class="card-title"><span class="icon">🥗</span> Food Plan – Today</span>
          ${(isDoctor || isCaretaker) ? `<button class="btn btn-icon" id="btn-edit-food" title="Edit Food">✏️</button>` : ''}
        </div>
        <div id="food-content"></div>
      </div>

      <!-- Snacks -->
      <div class="card">
        <div class="card-header">
          <span class="card-title"><span class="icon">🍎</span> Snacks – Today</span>
          ${(isDoctor || isCaretaker) ? `<button class="btn btn-icon" id="btn-add-snack" title="Add Snack">＋</button>` : ''}
        </div>
        <div id="snack-list-wrap"></div>
      </div>

      <!-- Water Intake -->
      <div class="card">
        <div class="card-header">
          <span class="card-title"><span class="icon">💧</span> Water Intake – Today</span>
          ${(isDoctor || isCaretaker) ? `<button class="btn btn-icon" id="btn-set-water-target" title="Set Target">🎯</button>` : ''}
        </div>
        <div id="water-content"></div>
      </div>

      <!-- Reminder Settings (Patient) -->
      ${role === 'patient' ? `
      <div class="card">
        <div class="card-header">
          <span class="card-title"><span class="icon">⏰</span> Reminder Settings</span>
        </div>
        <div class="reminder-card">
          <span class="reminder-icon">🔔</span>
          <div class="reminder-text">
            <h4>Medicine &amp; Water Reminders</h4>
            <p>Reminders are managed by your care team. Your doctor schedules medicines and your care taker logs water &amp; food intake. Notifications will appear based on set intervals.</p>
          </div>
        </div>
      </div>` : ''}

    </div>`;

  app.appendChild(dashEl);

  // Events
  document.getElementById('logout-btn').addEventListener('click', goRoleSelection);
  attachDashboardEvents(role);
  startRealtimeListeners(role);
}

// ════════════════════════════════════════════
//  ATTACH EVENTS
// ════════════════════════════════════════════
function attachDashboardEvents(role) {
  const isDoctor    = role === 'doctor';
  const isCaretaker = role === 'caretaker';

  if (isDoctor) {
    // Blood Sugar form toggle
    document.getElementById('btn-add-bs').addEventListener('click', () => {
      const f = document.getElementById('bs-form');
      f.style.display = f.style.display === 'none' ? 'flex' : 'none';
    });
    document.getElementById('btn-save-bs').addEventListener('click', saveBloodSugar);

    // Doctor PIN update
    document.getElementById('btn-save-pin').addEventListener('click', saveDoctorPin);

    // Medicine
    document.getElementById('btn-add-med').addEventListener('click', () => showAddMedicineModal());

    // Food
    document.getElementById('btn-edit-food').addEventListener('click', () => showEditFoodModal());

    // Snack
    document.getElementById('btn-add-snack').addEventListener('click', () => showAddSnackModal());

    // Water target
    document.getElementById('btn-set-water-target').addEventListener('click', () => showWaterTargetModal());
  }

  if (isCaretaker) {
    document.getElementById('btn-edit-food').addEventListener('click', () => showEditFoodModal());
    document.getElementById('btn-add-snack').addEventListener('click', () => showAddSnackModal());
    document.getElementById('btn-set-water-target').addEventListener('click', () => showWaterTargetModal());
  }
}

// ════════════════════════════════════════════
//  FIRESTORE REALTIME LISTENERS
// ════════════════════════════════════════════
function startRealtimeListeners(role) {
  const isDoctor = role === 'doctor';
  const daysBack = isDoctor ? 90 : 30;
  const cutoff   = cutoffDate(daysBack);
  const today    = todayDate();

  // Debounced renders to coalesce rapid Firestore updates into one paint
  const debouncedBS     = debounce(records => rafRun(() => renderBloodSugarChart('bs-chart', records)), 80);
  const debouncedMeds   = debounce(meds    => rafRun(() => renderMedicines(meds, role)), 80);
  const debouncedSnacks = debounce(snacks  => rafRun(() => renderSnacks(snacks, role)), 80);

  // Blood Sugar
  const bsQuery = col('bloodSugar')
    .where('date', '>=', cutoff)
    .orderBy('date', 'asc')
    .orderBy('createdAt', 'asc');

  addListener(bsQuery.onSnapshot(snap => {
    const records = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const wrap = document.querySelector('.chart-wrap');
    if (wrap && !document.getElementById('bs-chart')) {
      wrap.innerHTML = '<canvas id="bs-chart"></canvas>';
    }
    debouncedBS(records);
  }, err => console.error('bloodSugar:', err)));

  // Medicines
  addListener(col('medicines').orderBy('createdAt', 'asc').onSnapshot(snap => {
    debouncedMeds(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  }, err => console.error('medicines:', err)));

  // Food – today (single doc — no debounce needed, instant)
  addListener(col('foods').doc(today).onSnapshot(snap => {
    rafRun(() => renderFood(snap.exists ? { id: snap.id, ...snap.data() } : null, role));
  }, err => console.error('foods:', err)));

  // Snacks – today
  const snackQuery = col('snacks').where('date', '==', today).orderBy('createdAt', 'asc');
  addListener(snackQuery.onSnapshot(snap => {
    debouncedSnacks(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  }, err => console.error('snacks:', err)));

  // Water – today (single doc)
  addListener(col('water').doc(today).onSnapshot(snap => {
    rafRun(() => renderWater(snap.exists ? { id: snap.id, ...snap.data() } : null, role));
  }, err => console.error('water:', err)));
}

// ════════════════════════════════════════════
//  RENDER SECTIONS
// ════════════════════════════════════════════

function renderMedicines(meds, role) {
  const wrap = document.getElementById('medicine-list-wrap');
  if (!wrap) return;
  const isDoctor = role === 'doctor';
  if (meds.length === 0) {
    wrap.innerHTML = '<p class="empty-state">No medicines prescribed yet.</p>';
    return;
  }
  wrap.innerHTML = `<div class="medicine-list">
    ${meds.map(m => `
      <div class="medicine-item" data-id="${escHtml(m.id)}">
        <div class="medicine-dot"></div>
        <div class="medicine-info">
          <div class="med-name">${escHtml(m.name)}</div>
          <div class="med-detail">${escHtml(m.dosage)} &bull; at ${escHtml(m.time)}</div>
          ${m.prescribedByDoctor ? '<span class="prescribed-badge">Prescribed by Doctor</span>' : ''}
        </div>
        ${isDoctor ? `<button class="medicine-delete" data-id="${escHtml(m.id)}" title="Remove">🗑</button>` : ''}
      </div>`).join('')}
  </div>`;

  if (isDoctor) {
    wrap.querySelectorAll('.medicine-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await col('medicines').doc(btn.dataset.id).delete();
          toast('Medicine removed.', 'info');
        } catch { toast('Failed to remove.', 'error'); }
      });
    });
  }
}

function renderFood(food, role) {
  const wrap = document.getElementById('food-content');
  if (!wrap) return;
  wrap.innerHTML = `<div class="food-grid">
    <div class="food-meal">
      <div class="meal-label">🌅 Breakfast</div>
      <div class="meal-value">${food?.breakfast ? escHtml(food.breakfast) : 'None'}</div>
    </div>
    <div class="food-meal">
      <div class="meal-label">☀️ Lunch</div>
      <div class="meal-value">${food?.lunch ? escHtml(food.lunch) : 'None'}</div>
    </div>
    <div class="food-meal">
      <div class="meal-label">🌙 Dinner</div>
      <div class="meal-value">${food?.dinner ? escHtml(food.dinner) : 'None'}</div>
    </div>
  </div>`;
}

function renderSnacks(snacks, role) {
  const wrap = document.getElementById('snack-list-wrap');
  if (!wrap) return;
  const canEdit = role === 'doctor' || role === 'caretaker';
  if (snacks.length === 0) {
    wrap.innerHTML = '<p class="empty-state">No snacks recorded today.</p>';
    return;
  }
  wrap.innerHTML = `<div class="snack-list">
    ${snacks.map(s => `
      <div class="snack-item" data-id="${escHtml(s.id)}">
        <span style="font-size:16px;">🍽</span>
        <span class="snack-name">${escHtml(s.snackName)}</span>
        <span class="snack-time">${escHtml(s.time)}</span>
        ${canEdit ? `<button class="snack-delete" data-id="${escHtml(s.id)}" title="Remove">🗑</button>` : ''}
      </div>`).join('')}
  </div>`;

  if (canEdit) {
    wrap.querySelectorAll('.snack-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await col('snacks').doc(btn.dataset.id).delete();
          toast('Snack removed.', 'info');
        } catch { toast('Failed to remove.', 'error'); }
      });
    });
  }
}

function renderWater(water, role) {
  const wrap = document.getElementById('water-content');
  if (!wrap) return;
  const canEdit   = role === 'doctor' || role === 'caretaker';
  const consumed  = water?.consumedAmount ?? 0;
  const target    = water?.dailyTarget    ?? 3000;
  const pct       = Math.min((consumed / target) * 100, 100).toFixed(0);

  wrap.innerHTML = `
    <div class="water-stats">
      <div class="water-amount">${consumed}<span>ml</span></div>
      <div class="water-target">Target: <strong>${target}ml</strong></div>
    </div>
    <div class="progress-bar-wrap">
      <div class="progress-bar-fill" style="width:${pct}%"></div>
    </div>
    ${canEdit ? `<div class="water-actions">
      <button class="btn btn-primary btn-sm" id="btn-add-water">＋ 250ml</button>
    </div>` : ''}`;

  if (canEdit) {
    document.getElementById('btn-add-water').addEventListener('click', async () => {
      const today = todayDate();
      const ref   = col('water').doc(today);
      try {
        if (water) {
          await ref.update({ consumedAmount: firebase.firestore.FieldValue.increment(250) });
        } else {
          await ref.set({ consumedAmount: 250, dailyTarget: 3000, date: today, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        }
      } catch (e) { console.error(e); toast('Failed to update water.', 'error'); }
    });
  }
}

// ════════════════════════════════════════════
//  FIRESTORE WRITES
// ════════════════════════════════════════════

async function saveBloodSugar() {
  const val  = parseFloat(document.getElementById('bs-value').value);
  const type = document.getElementById('bs-type').value.trim() || 'random';
  if (isNaN(val) || val <= 0) { toast('Enter a valid blood sugar value.', 'error'); return; }
  try {
    await col('bloodSugar').add({
      value: val, time: type, date: todayDate(),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    document.getElementById('bs-value').value = '';
    document.getElementById('bs-type').value  = '';
    document.getElementById('bs-form').style.display = 'none';
    toast('Blood sugar logged!', 'success');
  } catch (e) { console.error(e); toast('Failed to save.', 'error'); }
}

async function saveDoctorPin() {
  const newPin  = document.getElementById('new-pin-input').value.trim();
  const confirm = document.getElementById('confirm-pin-input').value.trim();
  const errEl   = document.getElementById('pin-update-error');
  errEl.style.display = 'none';

  if (!newPin) { errEl.textContent = 'PIN cannot be empty.'; errEl.style.display = 'block'; return; }
  if (newPin !== confirm) { errEl.textContent = 'PINs do not match.'; errEl.style.display = 'block'; return; }

  try {
    await userDoc('doctorPin').set({ pin: newPin });
    document.getElementById('new-pin-input').value    = '';
    document.getElementById('confirm-pin-input').value = '';
    toast('Doctor PIN updated!', 'success');
  } catch (e) { console.error(e); toast('Failed to update PIN.', 'error'); }
}

// ════════════════════════════════════════════
//  MODALS
// ════════════════════════════════════════════

function showAddMedicineModal() {
  removeModalOverlay();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay'; overlay.id = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="med-title">
      <h2 id="med-title">💊 Add Medicine</h2>
      <p class="modal-sub">Prescribe a new medicine for the patient.</p>
      <div class="input-group"><label for="med-name">Medicine Name</label>
        <input type="text" id="med-name" placeholder="e.g. Metformin" /></div>
      <div class="input-group"><label for="med-dosage">Dosage</label>
        <input type="text" id="med-dosage" placeholder="e.g. 500mg" /></div>
      <div class="input-group"><label for="med-time">Time</label>
        <input type="text" id="med-time" placeholder="e.g. 08:00 AM" /></div>
      <div class="input-group">
        <label><input type="checkbox" id="med-prescribed" checked style="margin-right:6px" />Prescribed by Doctor</label>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="med-cancel">Cancel</button>
        <button class="btn btn-primary" id="med-save">Add Medicine</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('med-name').focus();
  overlay.addEventListener('click', e => { if (e.target === overlay) removeModalOverlay(); });
  document.getElementById('med-cancel').addEventListener('click', removeModalOverlay);
  document.getElementById('med-save').addEventListener('click', async () => {
    const name       = document.getElementById('med-name').value.trim();
    const dosage     = document.getElementById('med-dosage').value.trim();
    const time       = document.getElementById('med-time').value.trim();
    const prescribed = document.getElementById('med-prescribed').checked;
    if (!name || !dosage || !time) { toast('Please fill all fields.', 'error'); return; }
    try {
      await col('medicines').add({
        name, dosage, time, prescribedByDoctor: prescribed,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      removeModalOverlay();
      toast('Medicine added!', 'success');
    } catch (e) { console.error(e); toast('Failed to add medicine.', 'error'); }
  });
}

function showEditFoodModal() {
  removeModalOverlay();
  // Fetch existing food first then show modal
  col('foods').doc(todayDate()).get().then(snap => {
    const existing = snap.exists ? snap.data() : { breakfast: '', lunch: '', dinner: '' };
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay'; overlay.id = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="food-title">
        <h2 id="food-title">🥗 Edit Food Plan</h2>
        <p class="modal-sub">Set today's meal plan for the patient.</p>
        <div class="input-group"><label for="food-breakfast">🌅 Breakfast</label>
          <input type="text" id="food-breakfast" placeholder="e.g. Oats with fruits" value="${escHtml(existing.breakfast || '')}" /></div>
        <div class="input-group"><label for="food-lunch">☀️ Lunch</label>
          <input type="text" id="food-lunch" placeholder="e.g. Brown rice & salad" value="${escHtml(existing.lunch || '')}" /></div>
        <div class="input-group"><label for="food-dinner">🌙 Dinner</label>
          <input type="text" id="food-dinner" placeholder="e.g. Soup & whole grain bread" value="${escHtml(existing.dinner || '')}" /></div>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="food-cancel">Cancel</button>
          <button class="btn btn-primary" id="food-save">Save Plan</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    document.getElementById('food-breakfast').focus();
    overlay.addEventListener('click', e => { if (e.target === overlay) removeModalOverlay(); });
    document.getElementById('food-cancel').addEventListener('click', removeModalOverlay);
    document.getElementById('food-save').addEventListener('click', async () => {
      const breakfast = document.getElementById('food-breakfast').value.trim();
      const lunch     = document.getElementById('food-lunch').value.trim();
      const dinner    = document.getElementById('food-dinner').value.trim();
      try {
        await col('foods').doc(todayDate()).set(
          { breakfast, lunch, dinner, date: todayDate(), updatedAt: firebase.firestore.FieldValue.serverTimestamp() },
          { merge: true }
        );
        removeModalOverlay();
        toast('Food plan updated!', 'success');
      } catch (e) { console.error(e); toast('Failed to save food plan.', 'error'); }
    });
  }).catch(() => toast('Could not load food data.', 'error'));
}

function showAddSnackModal() {
  removeModalOverlay();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay'; overlay.id = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="snack-title">
      <h2 id="snack-title">🍎 Add Snack</h2>
      <p class="modal-sub">Record a snack for today.</p>
      <div class="input-group"><label for="snack-name-input">Snack Name</label>
        <input type="text" id="snack-name-input" placeholder="e.g. Apple" /></div>
      <div class="input-group"><label for="snack-time-input">Time</label>
        <input type="text" id="snack-time-input" placeholder="e.g. 16:00" value="${now24h()}" /></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="snack-cancel">Cancel</button>
        <button class="btn btn-primary" id="snack-save">Add Snack</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('snack-name-input').focus();
  overlay.addEventListener('click', e => { if (e.target === overlay) removeModalOverlay(); });
  document.getElementById('snack-cancel').addEventListener('click', removeModalOverlay);
  document.getElementById('snack-save').addEventListener('click', async () => {
    const name = document.getElementById('snack-name-input').value.trim();
    const time = document.getElementById('snack-time-input').value.trim();
    if (!name) { toast('Enter a snack name.', 'error'); return; }
    try {
      await col('snacks').add({
        snackName: name, time, date: todayDate(),
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      removeModalOverlay();
      toast('Snack added!', 'success');
    } catch (e) { console.error(e); toast('Failed to add snack.', 'error'); }
  });
}

function showWaterTargetModal() {
  removeModalOverlay();
  const today = todayDate();
  col('water').doc(today).get().then(snap => {
    const existing = snap.exists ? snap.data() : { dailyTarget: 3000 };
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay'; overlay.id = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="water-title">
        <h2 id="water-title">🎯 Set Water Target</h2>
        <p class="modal-sub">Set the daily water intake goal (in ml).</p>
        <div class="input-group"><label for="water-target-input">Daily Target (ml)</label>
          <input type="number" id="water-target-input" min="500" max="10000" value="${existing.dailyTarget || 3000}" /></div>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="water-cancel">Cancel</button>
          <button class="btn btn-primary" id="water-save">Set Target</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    document.getElementById('water-target-input').focus();
    overlay.addEventListener('click', e => { if (e.target === overlay) removeModalOverlay(); });
    document.getElementById('water-cancel').addEventListener('click', removeModalOverlay);
    document.getElementById('water-save').addEventListener('click', async () => {
      const target = parseInt(document.getElementById('water-target-input').value);
      if (isNaN(target) || target < 100) { toast('Enter a valid target.', 'error'); return; }
      try {
        await col('water').doc(today).set(
          { dailyTarget: target, date: today },
          { merge: true }
        );
        removeModalOverlay();
        toast('Water target updated!', 'success');
      } catch (e) { console.error(e); toast('Failed to update target.', 'error'); }
    });
  }).catch(() => toast('Could not load water data.', 'error'));
}

// ════════════════════════════════════════════
//  AUTH STATE LISTENER  (app entry point)
// ════════════════════════════════════════════
function boot() {
  // Ensure splash is removed even if auth takes a moment
  const splash = document.getElementById('splash');
  if (splash) {
    splash.classList.add('fade-out');
    setTimeout(() => splash.remove(), 400);
  }

  showLoading('Starting DiaCare…');
  console.log("App booting, waiting for auth state...");

  auth.onAuthStateChanged(user => {
    console.log("Auth state changed:", user ? "User logged in" : "No user");
    hideLoading();
    if (user) {
      currentUser = user;
      if (currentRole) renderDashboard(currentRole);
      else renderRoleScreen();
    } else {
      currentUser = null;
      currentRole = null;
      stopAllListeners();
      renderLoginScreen();
    }
  });
}

// Wait for Chart.js to be ready before booting
// (Chart.js is deferred — may not be ready at DOMContentLoaded)
// Start the app immediately
document.addEventListener('DOMContentLoaded', () => {
  console.log("DOM ready, booting...");
  boot();
});

// Handle visibility change — when user returns to tab, chart may need resize
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    const chart = charts['bs-chart'];
    if (chart) chart.resize();
  }
}, { passive: true });

// Resize handler with debounce — re-fit charts on orientation change
const debouncedResize = debounce(() => {
  const chart = charts['bs-chart'];
  if (chart) chart.resize();
}, 150);

window.addEventListener('resize', debouncedResize, { passive: true });
window.addEventListener('orientationchange', debouncedResize, { passive: true });
