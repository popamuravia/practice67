// server.js — обновлённая версия с поддержкой привязки push-подписок к user.id
const express = require('express');
const cors = require('cors');
const fs = require('fs');           // для existsSync
const fsp = require('fs').promises;
const path = require('path');
const jwt = require('jsonwebtoken');
const webPush = require('web-push');

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key';

// VAPID keys (можно переопределить в .env)
const vapidKeys = {
  publicKey: process.env.VAPID_PUBLIC_KEY || 'BDGtRpgdvZguMVsRpllMjFd83WWPDwzskC85Maof6JHQ2Yq3INAkxYOZp9c6283OckrKVmlsPt8Kmh6VY2SODUY',
  privateKey: process.env.VAPID_PRIVATE_KEY || 'JT62L5oUBsTidBFARGHXu4ogjsDRdRyv9cu-8vl5llU'
};
const multer = require('multer');


const uploadDir = path.join(__dirname, 'uploads');

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const safeName = Date.now() + '-' + file.originalname.replace(/\s+/g, '_');
        cb(null, safeName);
    }
});

const upload = multer({ storage });


try {
  webPush.setVapidDetails('mailto:admin@studentnotify.ru', vapidKeys.publicKey, vapidKeys.privateKey);
  console.log('✅ Push notifications initialized');
} catch (error) {
  console.warn('❌ Push setup failed — check VAPID keys:', error && error.message);
}

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Простая аутентификация для демо
function authenticate(req, res, next) {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Требуется авторизация' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Неверный токен' });
  }
}

// -------------------- DATA FILE HELPERS --------------------
async function ensureDataDir() {
  await fsp.mkdir('./data', { recursive: true });
}

async function readJSON(file, defaultData = null) {
  try {
    const content = await fsp.readFile(file, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    if (defaultData !== null) {
      await ensureDataDir();
      await fsp.writeFile(file, JSON.stringify(defaultData, null, 2));
      return defaultData;
    }
    throw err;
  }
}

async function writeJSON(file, data) {
  await ensureDataDir();
  await fsp.writeFile(file, JSON.stringify(data, null, 2));
}

// -------------------- NOTIFICATIONS --------------------
async function readNotifications() {
  const defaultData = { notifications: [], next_id: 1 };
  return await readJSON('./data/notifications.json', defaultData);
}
async function writeNotifications(data) {
  return await writeJSON('./data/notifications.json', data);
}

// -------------------- PUSH SUBSCRIPTIONS (KEYED BY userId) --------------------
// Файл хранит объект: { subscriptions: { "<userId>": <subscriptionObject>, ... } }
async function loadPushSubscriptionsFromFile() {
  const defaultData = { subscriptions: {} };
  return await readJSON('./data/push-subscriptions.json', defaultData);
}

async function savePushSubscriptionsToFile(obj) {
  return await writeJSON('./data/push-subscriptions.json', { subscriptions: obj });
}

// In-memory map for faster access (userId -> subscriptionObject)
let pushSubscriptions = {}; // will be loaded at server start
(async () => {
  try {
    const fileData = await loadPushSubscriptionsFromFile();
    pushSubscriptions = fileData.subscriptions || {};
    console.log(`📱 Loaded ${Object.keys(pushSubscriptions).length} push subscriptions`);
  } catch (err) {
    console.log('ℹ️ No push subscriptions file — starting with empty set');
    pushSubscriptions = {};
  }
})();

// -------------------- PUSH SENDING HELPERS --------------------
function sendPushToSubscription(subscription, payload) {
  return webPush.sendNotification(subscription, payload).catch(err => {
    throw err;
  });
}

async function sendPushToUser(userId, title, message, url = '/') {
  const subscription = pushSubscriptions[userId];
  if (!subscription) return false;

  const payload = JSON.stringify({ title, body: message, url });
  try {
    await sendPushToSubscription(subscription, payload);
    console.log(`✅ Push sent to ${userId}`);
    return true;
  } catch (err) {
    console.error('❌ Push error for', userId, err && err.message);
    if (err && err.statusCode && (err.statusCode === 404 || err.statusCode === 410)) {
      delete pushSubscriptions[userId];
      await savePushSubscriptionsToFile(pushSubscriptions);
      console.log(`🗑 Removed expired subscription for user ${userId}`);
    }
    return false;
  }
}

async function sendPushToAll(title, message, filterFn = null) {
  let sent = 0;
  const userIds = Object.keys(pushSubscriptions);
  for (const userId of userIds) {
    if (filterFn && !filterFn(userId)) continue;
    const ok = await sendPushToUser(userId, title, message);
    if (ok) sent++;
  }
  return sent;
}

// -------------------- API ROUTES --------------------
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Login (demo users)
app.post('/api/login', (req, res) => {
  const { login, password } = req.body || {};
  if (login === 'admin' && password === 'admin') {
    const token = jwt.sign({ id: 1, login: 'admin', role: 'admin' }, JWT_SECRET, { expiresIn: '24h' });
    return res.json({ token, user: { id: 1, login: 'admin', role: 'admin', name: 'Администратор системы' } });
  }
  if (login === 'student' && password === 'student') {
    const token = jwt.sign({ id: 2, login: 'student', role: 'student' }, JWT_SECRET, { expiresIn: '24h' });
    return res.json({ token, user: { id: 2, login: 'student', role: 'student', name: 'Иван Петров', group: 'ПИ-21' } });
  }
  res.status(401).json({ error: 'Неверный логин или пароль' });
});

// Notifications
app.get('/api/notifications', async (req, res) => {
  try {
    const data = await readNotifications();
    const sorted = data.notifications.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json(sorted);
  } catch (err) {
    res.status(500).json({ error: 'Не удалось загрузить уведомления' });
  }
});

app.post('/api/notifications', authenticate, upload.array('files'), async (req, res) => {
  try {
    if (req.user.role !== 'admin')
      return res.status(403).json({ error: 'Требуются права администратора' });

    const { title, content, is_important = false, category = 'общее',
            priority = 'medium', tags = [], send_push = false } = req.body;

    if (!title || !content)
      return res.status(400).json({ error: 'Заголовок и содержание обязательны' });

    // ✔ список файлов корректно собран
    const files = req.files?.map(f => ({
        name: f.originalname,
        stored: f.filename,
        url: '/uploads/' + f.filename
    })) || [];

    const data = await readNotifications();

    // ✔ добавляем files в уведомление
    const newNotification = {
      id: data.next_id++,
      title,
      content,
      author: req.user.login,
      created_at: new Date().toISOString(),
      is_important,
      category,
      priority,
      tags,
      files        //  ←←← ВАЖНО!
    };

    data.notifications.push(newNotification);
    await writeNotifications(data);

    // push
    if (send_push || is_important) {
      const pushTitle = is_important ? `🚨 ${title}` : `🔔 ${title}`;
      const pushMessage = content.length > 120 ? content.slice(0, 120) + '...' : content;
      await sendPushToAll(pushTitle, pushMessage);
    }

    res.status(201).json(newNotification);

  } catch (err) {
    console.error('Ошибка создания уведомления', err.message);
    res.status(500).json({ error: 'Ошибка создания уведомления' });
  }
});

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));


app.delete('/api/notifications/:id', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Требуются права администратора' });
    const id = parseInt(req.params.id);
    const data = await readNotifications();
    const idx = data.notifications.findIndex(n => n.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Не найдено' });
    data.notifications.splice(idx, 1);
    await writeNotifications(data);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка удаления' });
  }
});

// PUSH API: public key
app.get('/api/push/public-key', (req, res) => {
  res.json({ publicKey: vapidKeys.publicKey });
});

// Subscribe (save subscription for the authenticated user)
app.post('/api/push/subscribe', authenticate, async (req, res) => {
  try {
    const userId = String(req.user.id);
    const subscription = req.body;
    if (!subscription || !subscription.endpoint) return res.status(400).json({ error: 'Неверная подписка' });

    pushSubscriptions[userId] = subscription;
    await savePushSubscriptionsToFile(pushSubscriptions);
    console.log(`✅ Subscription saved for user ${userId}`);
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка сохранения подписки', err && err.message);
    res.status(500).json({ error: 'Не удалось сохранить подписку' });
  }
});

// Unsubscribe (remove subscription for authenticated user)
app.post('/api/push/unsubscribe', authenticate, async (req, res) => {
  try {
    const userId = String(req.user.id);
    if (pushSubscriptions[userId]) {
      delete pushSubscriptions[userId];
      await savePushSubscriptionsToFile(pushSubscriptions);
      console.log(`🗑 Subscription removed for user ${userId}`);
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка отписки', err && err.message);
    res.status(500).json({ error: 'Не удалось отписать' });
  }
});

// Admin: stats
app.get('/api/push/stats', authenticate, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Требуются права администратора' });
  const total = Object.keys(pushSubscriptions).length;
  res.json({ total, subscribers: Object.keys(pushSubscriptions) });
});

// Admin: send push with target option
app.post('/api/push/send', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Требуются права администратора' });
    const { title, message, target = 'all' } = req.body;
    if (!title || !message) return res.status(400).json({ error: 'title and message required' });

    let filterFn = null;
    if (target === 'students') {
      filterFn = (userId) => String(userId) === '2';
    }

    const sent = await sendPushToAll(title, message, filterFn);
    res.json({ sent });
  } catch (err) {
    console.error('Ошибка отправки push', err && err.message);
    res.status(500).json({ error: 'Ошибка отправки' });
  }
});

// Start server
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
console.log(`🌐 Ссылка: http://localhost:${PORT}`);
