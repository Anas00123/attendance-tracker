'use strict';

// ── Config ───────────────────────────────────────────────────────────────────
const CFG = {
  IN_TIME:           '09:30',
  OUT_TIME:          '18:30',
  HALF_OUT_LIMIT:    '14:30',
  FIRST_HALF_REPORT: '13:30',
  HALF_HOURS:        4,
  FULL_HOURS:        8,

  // Notification settings
  NOTIF_TIME:        '09:30',   // Fire reminder at this time
  NOTIF_DAYS:        [0,1,2,3,4,5,6], // 0=Sun … 6=Sat (all days)
  NOTIF_SNOOZE_MIN:  15,        // Snooze duration in minutes
  NOTIF_CHECK_MS:    30_000,    // Check every 30 seconds
  CLOUD_SYNC:        true,      // Sync user data across browsers
  CLOUD_BASE_URL:    'https://www.jsonstore.io',
};

const toMin = hhmm => { const [h,m] = hhmm.split(':').map(Number); return h*60+m; };
const IN_MIN         = toMin(CFG.IN_TIME);
const OUT_MIN        = toMin(CFG.OUT_TIME);
const HALF_OUT_MIN   = toMin(CFG.HALF_OUT_LIMIT);
const FH_REPORT_MIN  = toMin(CFG.FIRST_HALF_REPORT);
const NOTIF_MIN      = toMin(CFG.NOTIF_TIME);

// ── Storage Keys ─────────────────────────────────────────────────────────────
const SK = {
  RECORDS:        'att_records_v2',
  USERS:          'att_users_v2',
  SESSION:        'att_session_v2',
  NOTIF_PERM:     'att_notif_perm_v2',     // 'granted'|'denied'|'dismissed'
  NOTIF_SNOOZED:  'att_notif_snoozed_v2',  // ISO timestamp until snooze expires
  NOTIF_FIRED:    'att_notif_fired_v2',    // date string when last fired
};

// ── State ─────────────────────────────────────────────────────────────────────
let records = load(SK.RECORDS, []);
let users   = load(SK.USERS,   {});
let session = load(SK.SESSION, null);
let notifTimer = null;

// ── DOM ───────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const loginPage       = $('loginPage');
const dashPage        = $('dashPage');
const loginId         = $('loginId');
const loginName       = $('loginName');
const loginPassword   = $('loginPassword');
const loginBtn        = $('loginBtn');
const loginError      = $('loginError');
const togglePass      = $('togglePass');
const logoutBtn       = $('logoutBtn');
const topbarUser      = $('topbarUser');
const todayDate       = $('todayDate');
const todayBadge      = $('todayBadge');
const tiIn            = $('ti-in');
const tiOut           = $('ti-out');
const tiHours         = $('ti-hours');
const tiStatus        = $('ti-status');
const tiPoints        = $('ti-points');
const tiNote          = $('ti-note');
const clockInBtn      = $('clockInBtn');
const clockOutBtn     = $('clockOutBtn');
const halfLeaveBtn    = $('halfLeaveBtn');
const leaveBtn        = $('leaveBtn');
const monthPicker     = $('monthPicker');
const searchInput     = $('searchInput');
const historyBody     = $('historyBody');
const dlCsvBtn        = $('dlCsvBtn');
const dlXlsxBtn       = $('dlXlsxBtn');
const clearBtn        = $('clearBtn');

// Notification DOM
const notifBanner     = $('notifBanner');
const enableNotifBtn  = $('enableNotifBtn');
const dismissNotifBtn = $('dismissNotifBtn');
const notifStatusBar  = $('notifStatusBar');
const notifStatusText = $('notifStatusText');
const notifSettingsBtn= $('notifSettingsBtn');
const notifToggleBtn  = $('notifToggleBtn');
const toastBar        = $('toastBar');
const toastTitle      = $('toastTitle');
const toastMsg        = $('toastMsg');
const toastClockIn    = $('toastClockIn');
const toastDismiss    = $('toastDismiss');

// ─────────────────────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────────────────────
function init() {
  const now = new Date();
  monthPicker.value = `${now.getFullYear()}-${pad(now.getMonth()+1)}`;
  todayDate.textContent = formatDateFull(todayKey());

  // Core events
  loginBtn.addEventListener('click', () => { void handleLogin(); });
  togglePass.addEventListener('click', () => {
    loginPassword.type = loginPassword.type === 'password' ? 'text' : 'password';
  });
  [loginId, loginName, loginPassword].forEach(el =>
    el.addEventListener('keydown', e => { if (e.key === 'Enter') handleLogin(); })
  );
  logoutBtn.addEventListener('click', logout);
  clockInBtn.addEventListener('click', clockIn);
  clockOutBtn.addEventListener('click', clockOut);
  halfLeaveBtn.addEventListener('click', markFirstHalfLeave);
  leaveBtn.addEventListener('click', markLeave);
  monthPicker.addEventListener('change', render);
  searchInput.addEventListener('input', render);
  dlCsvBtn.addEventListener('click', downloadCSV);
  dlXlsxBtn.addEventListener('click', downloadExcel);
  clearBtn.addEventListener('click', clearMonth);

  // Notification events
  enableNotifBtn.addEventListener('click', requestNotifPermission);
  dismissNotifBtn.addEventListener('click', () => {
    save(SK.NOTIF_PERM, 'dismissed');
    notifBanner.classList.add('hidden');
    showNotifStatus();
  });
  notifSettingsBtn.addEventListener('click', showNotifSettings);
  notifToggleBtn.addEventListener('click', showNotifSettings);
  toastClockIn.addEventListener('click', () => { hideToast(); clockIn(); });
  toastDismiss.addEventListener('click', () => {
    hideToast();
    snoozeNotif();
  });

  // Page visibility — re-check when user comes back to tab
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && session) checkAndNotify();
  });

  route();
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTING
// ─────────────────────────────────────────────────────────────────────────────
function route() {
  session ? showDash() : showLogin();
}

function showLogin() {
  loginPage.classList.remove('hidden');
  dashPage.classList.add('hidden');
  loginError.classList.add('hidden');
  loginPassword.value = '';
  stopNotifTimer();
}

function showDash() {
  loginPage.classList.add('hidden');
  dashPage.classList.remove('hidden');
  topbarUser.textContent = `${session.name} (${session.userId})`;
  renderToday();
  render();
  initNotifications();
}

function logout() {
  session = null;
  localStorage.removeItem(SK.SESSION);
  stopNotifTimer();
  hideToast();
  showLogin();
}

// ─────────────────────────────────────────────────────────────────────────────
// LOGIN / REGISTER
// ─────────────────────────────────────────────────────────────────────────────
async function handleLogin() {
  const userId   = loginId.value.trim();
  const name     = loginName.value.trim();
  const password = loginPassword.value;

  if (!userId || !name || !password) { showError('Please fill in all fields.'); return; }
  if (password.length < 4)           { showError('Password must be at least 4 characters.'); return; }

  loginError.classList.add('hidden');
  loginBtn.disabled = true;
  loginBtn.textContent = 'Please wait...';

  try {
    const existing = users[userId];
    let cloudUser = null;
    try {
      cloudUser = await cloudReadUser(userId);
    } catch (e) {
      console.warn('Cloud sync unavailable during login. Continuing with local data.', e);
    }

    if (cloudUser) {
      if (cloudUser.password !== password) { showError('Incorrect password.'); return; }
      if (cloudUser.name !== name)         { showError('Name does not match this User ID.'); return; }

      users[userId] = { name: cloudUser.name, password: cloudUser.password };
      save(SK.USERS, users);
      replaceUserRecords(userId, Array.isArray(cloudUser.records) ? cloudUser.records : []);
    } else if (!existing) {
      users[userId] = { name, password };
      save(SK.USERS, users);
      await cloudWriteUser(userId, { name, password, records: getUserRecords(userId) });
    } else {
      if (existing.password !== password) { showError('Incorrect password.'); return; }
      if (existing.name !== name)         { showError('Name does not match this User ID.'); return; }
      await cloudWriteUser(userId, { name: existing.name, password: existing.password, records: getUserRecords(userId) });
    }

    session = { userId, name: users[userId].name };
    save(SK.SESSION, session);
    showDash();
  } catch (e) {
    console.warn('Login sync error:', e);
    showError('Could not sync data right now. Please check internet and try again.');
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Login / Register';
  }
}

function showError(msg) {
  loginError.textContent = msg;
  loginError.classList.remove('hidden');
}

// ─────────────────────────────────────────────────────────────────────────────
// NOTIFICATION SYSTEM
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Called once after login / on dash load.
 * - Shows the permission banner if not yet decided
 * - Starts the polling timer
 * - Runs an immediate check
 */
function initNotifications() {
  const stored = load(SK.NOTIF_PERM, null);
  const browserPerm = ('Notification' in window) ? Notification.permission : 'unsupported';

  if (browserPerm === 'unsupported') {
    // Browser doesn't support notifications — rely on in-page toast only
    showNotifStatus();
    startNotifTimer();
    checkAndNotify();
    return;
  }

  if (browserPerm === 'granted') {
    save(SK.NOTIF_PERM, 'granted');
    showNotifStatus();
    startNotifTimer();
    checkAndNotify();
    return;
  }

  if (browserPerm === 'denied') {
    save(SK.NOTIF_PERM, 'denied');
    showNotifStatus();
    startNotifTimer();   // still fire in-page toast
    checkAndNotify();
    return;
  }

  // 'default' — not yet asked
  if (stored === 'dismissed') {
    showNotifStatus();
    startNotifTimer();
    checkAndNotify();
    return;
  }

  // Show the permission banner
  notifBanner.classList.remove('hidden');
  notifStatusBar.classList.add('hidden');
  startNotifTimer();
  checkAndNotify();
}

async function requestNotifPermission() {
  if (!('Notification' in window)) {
    alert('Your browser does not support notifications. The in-page reminder will still work.');
    notifBanner.classList.add('hidden');
    showNotifStatus();
    return;
  }

  try {
    const result = await Notification.requestPermission();
    save(SK.NOTIF_PERM, result);
    notifBanner.classList.add('hidden');
    showNotifStatus();

    if (result === 'granted') {
      showToast('✅ Notifications enabled!', 'You\'ll get a reminder at 9:30 AM if attendance isn\'t marked.', false);
    } else {
      showToast('⚠️ Notifications blocked', 'An in-page banner will remind you instead.', false);
    }
  } catch (e) {
    console.warn('Notification permission error:', e);
  }
}

function showNotifStatus() {
  notifBanner.classList.add('hidden');
  const perm = ('Notification' in window) ? Notification.permission : 'unsupported';

  if (perm === 'granted') {
    notifStatusBar.classList.remove('hidden');
    notifStatusText.textContent = '🔔 Attendance reminders ON — you\'ll be notified at 9:30 AM';
    notifToggleBtn.title = 'Notifications enabled';
    notifToggleBtn.style.opacity = '1';
  } else if (perm === 'denied') {
    notifStatusBar.classList.remove('hidden');
    notifStatusText.textContent = '🔕 Browser notifications blocked — in-page reminder active';
    notifToggleBtn.title = 'Notifications blocked by browser';
    notifToggleBtn.style.opacity = '0.5';
  } else {
    notifStatusBar.classList.remove('hidden');
    notifStatusText.textContent = '🔔 In-page attendance reminder active at 9:30 AM';
    notifToggleBtn.title = 'Notification settings';
    notifToggleBtn.style.opacity = '0.8';
  }
}

function showNotifSettings() {
  const perm = ('Notification' in window) ? Notification.permission : 'unsupported';
  let msg = '';

  if (perm === 'granted') {
    msg = '✅ Browser notifications are ENABLED.\n\nYou will receive a system notification at 9:30 AM if attendance is not marked.\n\nTo disable: go to browser Settings → Site Settings → Notifications → Block this site.';
  } else if (perm === 'denied') {
    msg = '🔕 Browser notifications are BLOCKED.\n\nTo enable:\n1. Click the 🔒 lock icon in the address bar\n2. Set Notifications → Allow\n3. Refresh the page.\n\nAn in-page banner reminder is still active.';
  } else if (perm === 'unsupported') {
    msg = '⚠️ Your browser does not support notifications.\nAn in-page banner will remind you at 9:30 AM instead.';
  } else {
    msg = '🔔 Notifications not yet enabled.\n\nClick "Enable Notifications" on the banner to allow reminders at 9:30 AM.';
    notifBanner.classList.remove('hidden');
    notifStatusBar.classList.add('hidden');
    return;
  }

  alert(msg);
}

// ── Timer ────────────────────────────────────────────────────────────────────
function startNotifTimer() {
  stopNotifTimer();
  notifTimer = setInterval(checkAndNotify, CFG.NOTIF_CHECK_MS);
}

function stopNotifTimer() {
  if (notifTimer) { clearInterval(notifTimer); notifTimer = null; }
}

/**
 * Core check: should we fire a reminder right now?
 * Conditions:
 *   1. User is logged in
 *   2. Today is a configured reminder day
 *   3. Current time >= NOTIF_TIME (9:30 AM)
 *   4. Attendance not yet marked for today
 *   5. Not snoozed
 *   6. Not already fired today
 */
function checkAndNotify() {
  if (!session) return;

  const now     = new Date();
  const nowMin  = now.getHours() * 60 + now.getMinutes();
  const dayOfWk = now.getDay();

  // Day filter
  if (!CFG.NOTIF_DAYS.includes(dayOfWk)) return;

  // Time gate: only fire between NOTIF_TIME and end of day
  if (nowMin < NOTIF_MIN) return;
  if (nowMin > 23 * 60 + 59) return;   // sanity

  // Already marked?
  const rec = getToday();
  if (rec && (rec.inTime || rec.status === 'Leave' || rec.status === 'First Half Leave')) return;

  // Already fired today?
  const firedDate = load(SK.NOTIF_FIRED, null);
  if (firedDate === todayKey()) return;

  // Snoozed?
  const snoozedUntil = load(SK.NOTIF_SNOOZED, null);
  if (snoozedUntil && new Date() < new Date(snoozedUntil)) return;

  // ✅ Fire!
  fireReminder();
}

function fireReminder() {
  save(SK.NOTIF_FIRED, todayKey());

  const title = '⏰ Mark Your Attendance!';
  const body  = `Hi ${session.name}! You haven't clocked in yet. Tap to open the tracker.`;

  // 1. Try browser notification
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      const n = new Notification(title, {
        body,
        icon:  'https://cdn.jsdelivr.net/npm/twemoji@14/2/svg/1f4cb.svg',
        badge: 'https://cdn.jsdelivr.net/npm/twemoji@14/2/svg/1f4cb.svg',
        tag:   'attendance-reminder',
        requireInteraction: true,
      });

      n.onclick = () => {
        window.focus();
        n.close();
        hideToast();
      };
    } catch (e) {
      console.warn('Notification error:', e);
    }
  }

  // 2. Always show in-page toast (visible whether or not browser notif works)
  showToast(title, body, true);
}

function snoozeNotif() {
  const until = new Date(Date.now() + CFG.NOTIF_SNOOZE_MIN * 60_000);
  save(SK.NOTIF_SNOOZED, until.toISOString());
  // Clear today's fired flag so it can re-fire after snooze
  localStorage.removeItem(SK.NOTIF_FIRED);
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(title, msg, hasActions) {
  toastTitle.textContent = title;
  toastMsg.textContent   = msg;
  toastClockIn.classList.toggle('hidden', !hasActions);
  toastDismiss.textContent = hasActions ? `Snooze ${CFG.NOTIF_SNOOZE_MIN}m` : '✕';
  toastBar.classList.remove('hidden');
  toastBar.classList.add('toast-enter');

  // Auto-hide non-action toasts after 5s
  if (!hasActions) {
    setTimeout(hideToast, 5000);
  }
}

function hideToast() {
  toastBar.classList.add('hidden');
  toastBar.classList.remove('toast-enter');
}

// ─────────────────────────────────────────────────────────────────────────────
// ATTENDANCE ACTIONS
// ─────────────────────────────────────────────────────────────────────────────
function clockIn() {
  const today = todayKey();
  const rec   = getToday();

  if (rec && rec.inTime)             { alert('Clock-in already recorded today.'); return; }
  if (rec && rec.status === 'Leave') { alert('Today is marked as full leave.'); return; }

  const now  = new Date();
  const inT  = timeStr(now);
  const inM  = toMin(inT);
  const isFHL = Boolean(rec && rec.firstHalfLeave);

  if (isFHL && inM < FH_REPORT_MIN) {
    alert(`First-half-leave day: you must report at or after ${CFG.FIRST_HALF_REPORT}.`);
    return;
  }

  const late = isFHL ? inM > FH_REPORT_MIN : inM > IN_MIN;

  upsert({
    date: today, userId: session.userId, name: session.name,
    inTime: inT, outTime: '', late,
    status: isFHL ? 'First Half Leave – In Progress' : 'In Progress',
    hours: 0, points: 0, firstHalfLeave: Boolean(isFHL),
    note: isFHL ? 'First half leave' : late ? 'Late entry' : '',
  });

  hideToast();
  renderToday(); render();
}

function clockOut() {
  const rec = getToday();
  if (!rec || !rec.inTime) { alert('Clock-in first before clocking out.'); return; }
  if (rec.outTime)         { alert('Clock-out already recorded today.'); return; }

  const now  = new Date();
  const outT = timeStr(now);
  const outM = toMin(outT);
  const inM  = toMin(rec.inTime);
  const hrs  = Math.max(0, (outM - inM) / 60);

  rec.outTime = outT;
  rec.hours   = round2(hrs);

  const result = calcStatus(rec);
  rec.status   = result.status;
  rec.points   = result.points;
  rec.note     = result.note || rec.note || '';

  save(SK.RECORDS, records);
  void syncCurrentUserToCloud();
  renderToday(); render();
}

function markLeave() {
  const rec = getToday();
  if (rec && (rec.inTime || rec.outTime)) { alert('Cannot mark leave after clocking in.'); return; }

  upsert({
    date: todayKey(), userId: session.userId, name: session.name,
    inTime: '', outTime: '', late: false,
    status: 'Leave', hours: 0, points: 0, firstHalfLeave: false, note: 'Approved leave',
  });
  hideToast();
  renderToday(); render();
}

function markFirstHalfLeave() {
  const rec = getToday();
  if (rec && rec.inTime)             { alert('Cannot mark first-half leave after clocking in.'); return; }
  if (rec && rec.status === 'Leave') { alert('Today is already marked as full leave.'); return; }

  upsert({
    date: todayKey(), userId: session.userId, name: session.name,
    inTime: '', outTime: '', late: false,
    status: 'First Half Leave', hours: 0, points: 0, firstHalfLeave: true,
    note: `Report at or after ${CFG.FIRST_HALF_REPORT}`,
  });
  hideToast();
  renderToday(); render();
}

// ─────────────────────────────────────────────────────────────────────────────
// STATUS CALCULATION
// ─────────────────────────────────────────────────────────────────────────────
function calcStatus(rec) {
  if (!rec.inTime || !rec.outTime) return { status: 'In Progress', points: 0, note: '' };

  const inM  = toMin(rec.inTime);
  const outM = toMin(rec.outTime);

  if (rec.firstHalfLeave) {
    if (inM < FH_REPORT_MIN) return { status: 'Absent',   points: 0,   note: 'Reported before first-half-leave cutoff' };
    return                          { status: 'Half Day', points: 0.5, note: 'First half leave' };
  }

  if (outM <= HALF_OUT_MIN)                           return { status: 'Half Day', points: 0.5, note: `Left at/before ${CFG.HALF_OUT_LIMIT}` };
  if (rec.hours >= CFG.FULL_HOURS && outM >= OUT_MIN) return { status: 'Present',  points: 1,   note: rec.late ? 'Late entry' : '' };
  if (rec.hours >= CFG.HALF_HOURS)                    return { status: 'Half Day', points: 0.5, note: 'Worked half-day hours' };
  return { status: 'Absent', points: 0, note: 'Insufficient hours' };
}

// ─────────────────────────────────────────────────────────────────────────────
// RENDER
// ─────────────────────────────────────────────────────────────────────────────
function renderToday() {
  const rec = getToday();

  if (!rec) {
    tiIn.textContent = tiOut.textContent = tiHours.textContent =
    tiStatus.textContent = tiPoints.textContent = tiNote.textContent = '—';
    setBadge('Not Marked', 'badge-none');
    return;
  }

  tiIn.textContent     = rec.inTime  || '—';
  tiOut.textContent    = rec.outTime || '—';
  tiHours.textContent  = rec.hours   ? `${rec.hours} hrs` : '—';
  tiStatus.textContent = rec.status  || '—';
  tiPoints.textContent = rec.points !== undefined ? rec.points : '—';
  tiNote.textContent   = rec.note    || '—';

  const s = rec.status || '';
  if      (s === 'Present')                                setBadge('Present',     'badge-present');
  else if (s.includes('Half Day') || s.includes('Half'))  setBadge('Half Day',    'badge-halfday');
  else if (s === 'Leave')                                  setBadge('Leave',       'badge-leave');
  else if (s === 'Absent')                                 setBadge('Absent',      'badge-absent');
  else if (s.includes('Progress'))                         setBadge('In Progress', 'badge-progress');
  else                                                     setBadge(s || 'Not Marked', 'badge-none');
}

function setBadge(text, cls) {
  todayBadge.textContent = text;
  todayBadge.className   = `status-badge ${cls}`;
}

function render() {
  const rows = filteredRows();
  renderTable(rows);
  renderStats(rows);
}

function filteredRows() {
  if (!session) return [];
  const month  = monthPicker.value;
  const search = searchInput.value.trim().toLowerCase();
  return records
    .filter(r => r.userId === session.userId)
    .filter(r => r.date.startsWith(month))
    .filter(r => `${r.date} ${r.status} ${r.note || ''}`.toLowerCase().includes(search))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function renderTable(rows) {
  historyBody.innerHTML = '';
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  for (const r of rows) {
    const dayName = days[new Date(r.date + 'T00:00:00').getDay()];
    const sCls    = statusClass(r.status);
    const tr      = document.createElement('tr');
    tr.innerHTML  = `
      <td>${r.date}</td>
      <td>${dayName}</td>
      <td>${r.inTime  || '—'}</td>
      <td>${r.outTime || '—'}</td>
      <td>${r.hours   || '—'}</td>
      <td class="${r.late ? 'col-late-yes' : ''}">${r.late ? 'Yes' : 'No'}</td>
      <td class="col-status ${sCls}">${r.status}</td>
      <td>${r.points}</td>
      <td>${r.note || ''}</td>`;
    historyBody.appendChild(tr);
  }

  if (!rows.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="9" style="text-align:center;color:var(--text-faint);padding:28px;font-family:'DM Sans',sans-serif;">No records found for this month.</td>`;
    historyBody.appendChild(tr);
  }
}

function statusClass(s) {
  if (!s) return '';
  if (s === 'Present')                          return 's-present';
  if (s.includes('Half') || s === 'Half Day')  return 's-halfday';
  if (s === 'Leave')                            return 's-leave';
  if (s === 'Absent')                           return 's-absent';
  if (s.includes('Progress'))                   return 's-progress';
  return '';
}

function renderStats(rows) {
  const present = rows.filter(r => r.status === 'Present').length;
  const halfday = rows.filter(r => (r.status || '').includes('Half')).length;
  const leave   = rows.filter(r => r.status === 'Leave').length;
  const late    = rows.filter(r => r.late).length;
  const points  = round2(rows.reduce((s, r) => s + (Number(r.points) || 0), 0));
  const workDays= rows.filter(r => !['Leave','In Progress','First Half Leave'].includes(r.status)).length;
  const pct     = workDays ? Math.round((points / workDays) * 100) : 0;

  $('s-present').textContent = present;
  $('s-halfday').textContent = halfday;
  $('s-leave').textContent   = leave;
  $('s-late').textContent    = late;
  $('s-points').textContent  = points;
  $('s-pct').textContent     = `${pct}%`;
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT
// ─────────────────────────────────────────────────────────────────────────────
function downloadCSV() {
  const rows = filteredRows();
  if (!rows.length) { alert('No records for selected month.'); return; }

  const days  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const hdr   = ['Date','Day','In Time','Out Time','Hours','Late','Status','Points','Note'];
  const lines = [hdr.join(',')];

  for (const r of rows) {
    const day = days[new Date(r.date+'T00:00:00').getDay()];
    lines.push([r.date,day,r.inTime||'',r.outTime||'',r.hours,
      r.late?'Yes':'No',r.status,r.points,r.note||''].map(csvSafe).join(','));
  }

  triggerDownload(lines.join('\n'), `attendance_${monthPicker.value}.csv`, 'text/csv;charset=utf-8;');
}

function downloadExcel() {
  const rows = filteredRows();
  if (!rows.length) { alert('No records for selected month.'); return; }

  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const data = rows.map(r => ({
    Date: r.date, Day: days[new Date(r.date+'T00:00:00').getDay()],
    'In Time': r.inTime||'', 'Out Time': r.outTime||'',
    Hours: r.hours, Late: r.late?'Yes':'No',
    Status: r.status, Points: r.points, Note: r.note||'',
  }));

  const present = rows.filter(r => r.status === 'Present').length;
  const half    = rows.filter(r => (r.status||'').includes('Half')).length;
  const leave   = rows.filter(r => r.status === 'Leave').length;
  const late    = rows.filter(r => r.late).length;
  const pts     = round2(rows.reduce((s,r) => s+(Number(r.points)||0), 0));

  const summaryData = [
    { Metric: 'User',         Value: `${session.name} (${session.userId})` },
    { Metric: 'Month',        Value: monthPicker.value },
    { Metric: 'Present Days', Value: present },
    { Metric: 'Half Days',    Value: half },
    { Metric: 'Leaves',       Value: leave },
    { Metric: 'Late Days',    Value: late },
    { Metric: 'Total Points', Value: pts },
  ];

  const wb  = XLSX.utils.book_new();
  const ws1 = XLSX.utils.json_to_sheet(data);
  const ws2 = XLSX.utils.json_to_sheet(summaryData);
  ws1['!cols'] = [10,6,9,10,7,5,18,7,25].map(w => ({ wch: w }));
  ws2['!cols'] = [18,28].map(w => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws1, 'Attendance');
  XLSX.utils.book_append_sheet(wb, ws2, 'Summary');
  XLSX.writeFile(wb, `attendance_${session.userId}_${monthPicker.value}.xlsx`);
}

// ─────────────────────────────────────────────────────────────────────────────
// CLEAR MONTH
// ─────────────────────────────────────────────────────────────────────────────
function clearMonth() {
  const month = monthPicker.value;
  const count = records.filter(r => r.userId === session.userId && r.date.startsWith(month)).length;
  if (!count) { alert('No records found for this month.'); return; }
  if (!confirm(`Delete all ${count} record(s) for ${month}? This cannot be undone.`)) return;
  records = records.filter(r => !(r.userId === session.userId && r.date.startsWith(month)));
  save(SK.RECORDS, records);
  void syncCurrentUserToCloud();
  renderToday(); render();
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function getToday() {
  return records.find(r => r.date === todayKey() && r.userId === session?.userId);
}

function upsert(rec) {
  const idx = records.findIndex(r => r.date === rec.date && r.userId === rec.userId);
  if (idx >= 0) records[idx] = { ...records[idx], ...rec };
  else records.push(rec);
  save(SK.RECORDS, records);
  void syncCurrentUserToCloud();
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

function timeStr(d) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDateFull(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-IN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

function pad(n) { return String(n).padStart(2, '0'); }
function round2(n) { return Math.round(n * 100) / 100; }
function csvSafe(v) { return `"${String(v).replace(/"/g, '""')}"`; }

function triggerDownload(content, name, mime) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function load(key, def) {
  try { return JSON.parse(localStorage.getItem(key)) ?? def; } catch { return def; }
}

function save(key, val) {
  localStorage.setItem(key, JSON.stringify(val));
}

function getUserRecords(userId) {
  return records.filter(r => r.userId === userId);
}

function replaceUserRecords(userId, nextUserRecords) {
  records = records
    .filter(r => r.userId !== userId)
    .concat(nextUserRecords.map(r => ({ ...r, userId })));
  save(SK.RECORDS, records);
}

async function syncCurrentUserToCloud() {
  if (!session || !CFG.CLOUD_SYNC) return;
  const user = users[session.userId];
  if (!user) return;
  await cloudWriteUser(session.userId, {
    name: user.name,
    password: user.password,
    records: getUserRecords(session.userId),
  });
}

function cloudKey(userId) {
  return `attendance-tracker-v1-${String(userId).trim().toLowerCase()}`;
}

async function cloudReadUser(userId) {
  if (!CFG.CLOUD_SYNC) return null;
  const res = await fetch(`${CFG.CLOUD_BASE_URL}/${encodeURIComponent(cloudKey(userId))}`);
  if (!res.ok) return null;
  const payload = await res.json();
  if (!payload || payload.result == null) return null;
  return payload.result;
}

async function cloudWriteUser(userId, data) {
  if (!CFG.CLOUD_SYNC) return;
  const safe = {
    name: data.name,
    password: data.password,
    records: Array.isArray(data.records) ? data.records : [],
    updatedAt: new Date().toISOString(),
  };
  try {
    await fetch(`${CFG.CLOUD_BASE_URL}/${encodeURIComponent(cloudKey(userId))}`, {
      method: 'POST',
      // text/plain avoids CORS preflight in stricter browser setups
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(safe),
    });
  } catch (e) {
    console.warn('Cloud write failed:', e);
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────
init();