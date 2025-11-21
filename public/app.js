let authToken = null;
let currentUser = null;
let allNotifications = [];
let currentFilters = { category: 'all', importance: 'all', priority: 'all', search: '' };
let swRegistration = null;
let pushSubscription = null;


window.onload = () => {
  registerServiceWorker();
  checkAuth();
};



// ---------------- AUTH ----------------
async function login() {
  const loginVal = document.getElementById('login').value.trim();
  const passVal = document.getElementById('password').value.trim();
  if (!loginVal || !passVal) return alert('Введите логин и пароль');
  try {
    const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: loginVal, password: passVal }) });
    if (!res.ok) throw new Error('Неверные учетные данные');
    const data = await res.json();
    
    authToken = data.token;
    
    currentUser = data.user;
    
    localStorage.setItem('authToken', authToken);
    localStorage.setItem('currentUser', JSON.stringify(currentUser));
    showMainApp();
  } catch (err) {
    alert('Ошибка входа: ' + err.message);
  }
}

function logout() {
  authToken = null; currentUser = null; localStorage.removeItem('authToken'); localStorage.removeItem('currentUser');
  document.getElementById("admin-tab").classList.add("hidden");
document.getElementById("admin-tab").style.display = "none";

  document.getElementById('main-app').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
}

function checkAuth() {
  const token = localStorage.getItem('authToken');
  const user = localStorage.getItem('currentUser');
  if (token && user) {
    authToken = token; currentUser = JSON.parse(user); showMainApp();
  }
}

function showMainApp() {
  const adminTab = document.getElementById("admin-tab");
  adminTab.style.display = "none";
  adminTab.classList.add("hidden");

  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('main-app').classList.remove('hidden');
  document.getElementById('user-info').textContent = `${currentUser.name} (${currentUser.role})`;

  if (currentUser.role === "admin") {
    adminTab.classList.remove("hidden");
    adminTab.style.display = "inline-block";
  }

  showTab('notifications');
  loadNotifications();
  updatePushUI();
}




// ---------------- TABS ----------------
function showTab(name) {
  const tabs = document.querySelectorAll('.tab-panel');
  tabs.forEach(t => t.classList.add('hidden'));
  document.getElementById('tab-' + name).classList.remove('hidden');

  const tabButtons = document.querySelectorAll('.tab');
  tabButtons.forEach(b => b.classList.remove('active'));
  document.querySelectorAll(`.tab[data-tab="${name}"]`).forEach(b => b.classList.add('active'));
}

// ---------------- SERVICE WORKER & PUSH ----------------
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return console.warn('SW not supported');
  try {
    swRegistration = await navigator.serviceWorker.register('/sw.js');
    console.log('SW registered');
  } catch (err) {
    console.error('SW registration failed', err);
  }
}

async function updatePushUIStatus(enabled, text) {
  const dot = document.getElementById('push-status-dot');
  const txt = document.getElementById('push-status-text');
  const btn = document.getElementById('push-toggle-btn');
  if (enabled) {
    dot.className = 'dot online';
    btn.textContent = 'Выключить уведомления';
  } else {
    dot.className = 'dot offline';
    btn.textContent = 'Включить уведомления';
  }
  txt.textContent = text;
}

async function updatePushUI() {
  if (!swRegistration) return updatePushUIStatus(false, 'Service Worker не готов');
  try {
    const sub = await swRegistration.pushManager.getSubscription();
    pushSubscription = sub;
    if (sub) {
      updatePushUIStatus(true, 'Подписка активна');
    } else {
      updatePushUIStatus(false, 'Подписка отсутствует');
    }
  } catch (err) {
    updatePushUIStatus(false, 'Ошибка проверки');
  }
}

async function togglePush() {
  if (!currentUser || !authToken) return alert('Требуется вход');
  if (!swRegistration) return alert('Service Worker не зарегистрирован');

  if (pushSubscription) {
    try {
      await pushSubscription.unsubscribe();
    } catch (e) { console.warn('client unsubscribe failed', e); }
    await fetch('/api/push/unsubscribe', { method: 'POST', headers: { 'Authorization': 'Bearer ' + authToken } });
    pushSubscription = null;
    updatePushUIStatus(false, 'Уведомления выключены');
    return;
  }

  if (Notification.permission === 'denied') return alert('Уведомления запрещены в браузере');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return updatePushUIStatus(false, 'Разрешение не предоставлено');

  try {
    const resp = await fetch('/api/push/public-key');
    const data = await resp.json();
    const applicationServerKey = urlBase64ToUint8Array(data.publicKey);
    const sub = await swRegistration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
    // send to server
    await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken }, body: JSON.stringify(sub) });
    pushSubscription = sub;
    updatePushUIStatus(true, 'Уведомления включены');
  } catch (err) {
    console.error('subscribe failed', err);
    updatePushUIStatus(false, 'Ошибка подписки');
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function openNotificationPermission() {
  alert('Откройте настройки сайта в браузере, чтобы изменить разрешения уведомлений.');
}

// ---------------- NOTIFICATIONS ----------------
async function loadNotifications() {
  try {
    const res = await fetch('/api/notifications');
    if (!res.ok) throw new Error('Не удалось загрузить уведомления');
    allNotifications = await res.json();
    renderNotifications();
  } catch (err) {
    document.getElementById('notifications-container').innerHTML = '<div class="card">Ошибка загрузки уведомлений</div>';
  }
}

function renderNotifications() {
  const container = document.getElementById('notifications-container');
  const filtered = allNotifications.filter(n => {
    if (currentFilters.category !== 'all' && n.category !== currentFilters.category) return false;
    if (currentFilters.importance === 'important' && !n.is_important) return false;
    if (currentFilters.importance === 'normal' && n.is_important) return false;
    if (currentFilters.priority !== 'all' && n.priority !== currentFilters.priority) return false;
    if (currentFilters.search && !(n.title.toLowerCase().includes(currentFilters.search) || n.content.toLowerCase().includes(currentFilters.search) || (n.tags && n.tags.join(' ').toLowerCase().includes(currentFilters.search)))) return false;
    return true;
  });
  if (filtered.length === 0) { container.innerHTML = '<div class="card empty">Уведомлений не найдено</div>'; return; }
  container.innerHTML = filtered.map(n => notificationCard(n)).join(''); 
}

function translatePriority(p) {
    switch (p) {
        case "critical": return "Критический";
        case "high": return "Высокий";
        case "medium": return "Средний";
        case "low": return "Низкий";
        default: return "";
    }
}

function notificationCard(n) {
  const important = n.is_important ? '<span class="badge important">ВАЖНО</span>' : '';
  const tags = n.tags && n.tags.length
    ? `<div class="tags">${n.tags.map(t => `<span class="tag" onclick="searchByTag('${t}')">${t}</span>`).join('')}</div>`
    : '';

  let filesHtml = "";
  if (n.files && n.files.length > 0) {
      filesHtml = `
        <div class="files">
            ${n.files.map(f => `
                <a class="file-link" href="${f.url}" download>
                    📎 ${f.name}
                </a>
            `).join("")}
        </div>
      `;
  }

  return `
<div class="card notif-card">
  <div class="notif-head">
    <div class="title">${escapeHtml(n.title)} ${important}</div>
    <div class="meta">${n.author} • ${new Date(n.created_at).toLocaleString()}</div>
  </div>

  <div class="content">${escapeHtml(n.content)}</div>
  ${filesHtml}
  ${tags}

  ${currentUser.role === "admin" ? `
    <button class="btn outline small delete-btn" onclick="deleteNotification(${n.id})">
      Удалить
    </button>
  ` : ""}
</div>`;
}



function escapeHtml(text) { return text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'); }

function onSearchInput(e) { currentFilters.search = e.target.value.toLowerCase(); renderNotifications(); }
function applyFilterChange() { currentFilters.category = document.getElementById('filter-category').value; currentFilters.importance = document.getElementById('filter-importance').value; currentFilters.priority = document.getElementById('filter-priority').value; renderNotifications(); }
function clearFilters() { document.getElementById('filter-category').value = 'all'; document.getElementById('filter-importance').value = 'all'; document.getElementById('filter-priority').value = 'all'; currentFilters = { category: 'all', importance: 'all', priority: 'all', search: '' }; document.getElementById('search-input').value = ''; renderNotifications(); }
function searchByTag(tag) { document.getElementById('search-input').value = tag; currentFilters.search = tag.toLowerCase(); showTab('notifications'); renderNotifications(); }
let filesHtml = "";



// ---------------- ADMIN ACTIONS ----------------
async function createNotification() {
    const form = new FormData();
    form.append("title", document.getElementById("notification-title").value);
    form.append("content", document.getElementById("notification-content").value);
    form.append("is_important", document.getElementById("notification-important").checked);
    form.append("priority", document.getElementById("notification-priority").value);
    form.append("send_push", document.getElementById("notification-send-push").checked);

    const filesInput = document.getElementById("notification-files");
    for (const file of filesInput.files) {
        form.append("files", file);
    }

    const res = await fetch("/api/notifications", {
        method: "POST",
        headers: { "Authorization": "Bearer " + authToken },
        body: form
    });

    if (!res.ok) return alert("Ошибка создания");

    await loadNotifications();
    alert("Уведомление создано");
}


async function sendAdminPush() {
  if (!currentUser || currentUser.role !== 'admin') return alert('Только админ');
  const title = document.getElementById('push-title').value.trim();
  const message = document.getElementById('push-message').value.trim();
  const target = document.getElementById('push-target').value;
  if (!title || !message) return alert('Заполните поля');
  const res = await fetch('/api/push/send', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken }, body: JSON.stringify({ title, message, target }) });
  if (!res.ok) return alert('Ошибка отправки');
  const data = await res.json();
  alert(`Отправлено: ${data.sent}`);
}
async function deleteNotification(id) {
  if (!currentUser || currentUser.role !== "admin")
    return alert("Удалять может только администратор");

  if (!confirm("Удалить уведомление?")) return;

  const res = await fetch(`/api/notifications/${id}`, {
    method: "DELETE",
    headers: {
      "Authorization": "Bearer " + authToken
    }
  });

  if (!res.ok) {
    alert("Ошибка удаления");
    return;
  }

  await loadNotifications();
}


