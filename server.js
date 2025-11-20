const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const webPush = require('web-push');

const NOTIFICATION_CATEGORIES = {
    SCHEDULE: 'расписание',
    STUDIES: 'учеба',
    EVENTS: 'мероприятия',
    TECHNICAL: 'техническое',
    URGENT: 'срочное',
    GENERAL: 'общее'
};

const NOTIFICATION_PRIORITIES = {
    LOW: 'low',
    MEDIUM: 'medium', 
    HIGH: 'high',
    CRITICAL: 'critical'
};

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key';

// Инициализация Web Push
const vapidKeys = {
  publicKey: process.env.VAPID_PUBLIC_KEY || 'BDGtRpgdvZguMVsRpllMjFd83WWPDwzskC85Maof6JHQ2Yq3INAkxYOZp9c6283OckrKVmlsPt8Kmh6VY2SODUY',
  privateKey: process.env.VAPID_PRIVATE_KEY || 'JT62L5oUBsTidBFARGHXu4ogjsDRdRyv9cu-8vl5llU'
};

try {
  webPush.setVapidDetails(
    'mailto:admin@studentnotify.ru',
    vapidKeys.publicKey,
    vapidKeys.privateKey
  );
  console.log('✅ Push notifications initialized');
} catch (error) {
  console.log('❌ Push setup failed:', error.message);
  console.log('Please check your VAPID keys in .env file');
}

// Хранилище подписок
const pushSubscriptions = new Map();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 🔐 AUTHENTICATION MIDDLEWARE
function authenticate(req, res, next) {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
        return res.status(401).json({ error: 'Требуется авторизация' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Неверный токен' });
    }
}

// 📁 Функции для работы с файлами
async function readNotifications() {
    try {
        const data = await fs.readFile('./data/notifications.json', 'utf8');
        return JSON.parse(data);
    } catch (error) {
        // Создаем папку и файл если не существует
        await fs.mkdir('./data', { recursive: true });
        const defaultData = { 
            notifications: [
                {
                    id: 1,
                    title: "Добро пожаловать!",
                    content: "Система уведомлений успешно запущена",
                    author: "admin",
                    created_at: new Date().toISOString(),
                    is_important: true,
                    tags: ["приветствие"],
                    category: "общее",
                    priority: "medium"
                }
            ], 
            next_id: 2 
        };
        await fs.writeFile('./data/notifications.json', JSON.stringify(defaultData, null, 2));
        return defaultData;
    }
}

async function writeNotifications(data) {
    await fs.writeFile('./data/notifications.json', JSON.stringify(data, null, 2));
}

// 📧 PUSH УВЕДОМЛЕНИЯ - Функции

// Сохранить подписки в файл
function savePushSubscriptions() {
    const subscriptions = Array.from(pushSubscriptions.entries());
    const data = { subscriptions };
    fsSync.writeFileSync('./data/push-subscriptions.json', JSON.stringify(data, null, 2));
}

// Загрузить подписки из файла
function loadPushSubscriptions() {
    try {
        const data = fsSync.readFileSync('./data/push-subscriptions.json', 'utf8');
        const parsed = JSON.parse(data);
        parsed.subscriptions.forEach(([userId, subscription]) => {
            pushSubscriptions.set(userId, subscription);
        });
        console.log(`📱 Loaded ${pushSubscriptions.size} push subscriptions`);
    } catch (error) {
        console.log('No push subscriptions file found');
    }
}

// Отправить уведомление пользователю
function sendPushToUser(userId, title, message, url = '/') {
    const subscription = pushSubscriptions.get(userId);
    if (!subscription) {
        console.log(`No subscription found for user: ${userId}`);
        return false;
    }

    const payload = JSON.stringify({
        title: title,
        body: message,
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-72.png',
        tag: 'student-notification',
        data: { url: url },
        actions: [
            { action: 'open', title: 'Открыть' },
            { action: 'close', title: 'Закрыть' }
        ]
    });

    webPush.sendNotification(subscription, payload)
        .then(() => console.log(`✅ Push sent to ${userId}: ${title}`))
        .catch(error => {
            console.error('❌ Push error:', error);
            // Удаляем невалидную подписку
            if (error.statusCode === 410) {
                pushSubscriptions.delete(userId);
                savePushSubscriptions();
            }
        });

    return true;
}

// Отправить уведомление всем пользователям
function sendPushToAll(title, message, url = '/') {
    let sentCount = 0;
    pushSubscriptions.forEach((subscription, userId) => {
        if (sendPushToUser(userId, title, message, url)) {
            sentCount++;
        }
    });
    console.log(`📨 Push sent to ${sentCount} users`);
    return sentCount;
}

// 🔐 API Маршруты

// Login
app.post('/api/login', async (req, res) => {
    try {
        const { login, password } = req.body;
        
        // Простая проверка для демо
        if (login === 'admin' && password === 'admin') {
            const token = jwt.sign(
                { id: 1, login: 'admin', role: 'admin' },
                JWT_SECRET,
                { expiresIn: '24h' }
            );
            
            return res.json({
                token,
                user: {
                    id: 1,
                    login: 'admin',
                    role: 'admin',
                    name: 'Администратор системы'
                }
            });
        }
        
        if (login === 'student' && password === 'student') {
            const token = jwt.sign(
                { id: 2, login: 'student', role: 'student' },
                JWT_SECRET,
                { expiresIn: '24h' }
            );
            
            return res.json({
                token,
                user: {
                    id: 2,
                    login: 'student',
                    role: 'student',
                    name: 'Иван Петров',
                    group: 'ПИ-21'
                }
            });
        }

        res.status(401).json({ error: 'Неверный логин или пароль' });
        
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Получить уведомления
app.get('/api/notifications', async (req, res) => {
    try {
        const data = await readNotifications();
        const sortedNotifications = data.notifications.sort((a, b) => 
            new Date(b.created_at) - new Date(a.created_at)
        );
        res.json(sortedNotifications);
    } catch (error) {
        console.error('Error loading notifications:', error);
        res.status(500).json({ error: 'Не удалось загрузить уведомления' });
    }
});

// Создать уведомление
app.post('/api/notifications', authenticate, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Требуются права администратора' });
        }
        
        const { 
            title, 
            content, 
            is_important = false, 
            category = 'общее',
            priority = 'medium',
            tags = [],
            send_push = false
        } = req.body;
        
        if (!title || !content) {
            return res.status(400).json({ error: 'Заголовок и содержание обязательны' });
        }
        
        // Обрабатываем теги (разделяем строку по запятым)
        let processedTags = [];
        if (typeof tags === 'string') {
            processedTags = tags.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
        } else if (Array.isArray(tags)) {
            processedTags = tags;
        }
        
        const data = await readNotifications();
        const newNotification = {
            id: data.next_id++,
            title,
            content,
            author: req.user.login,
            created_at: new Date().toISOString(),
            is_important,
            category: category || 'общее',
            priority: priority || 'medium',
            tags: processedTags
        };
        
        data.notifications.push(newNotification);
        await writeNotifications(data);
        
        console.log('✅ Создано уведомление с категорией:', category);
        
        // 📧 Отправляем Push-уведомление если запрошено
        if (send_push || is_important) {
            const pushTitle = is_important ? `🚨 ${title}` : `🔔 ${title}`;
            const pushMessage = content.length > 100 ? content.substring(0, 100) + '...' : content;
            const sentCount = sendPushToAll(pushTitle, pushMessage);
            console.log(`📨 Push отправлен ${sentCount} пользователям`);
        }
        
        res.status(201).json(newNotification);
        
    } catch (error) {
        console.error('Ошибка создания уведомления:', error);
        res.status(500).json({ error: 'Ошибка создания уведомления' });
    }
});

// Удалить уведомление
app.delete('/api/notifications/:id', authenticate, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Требуются права администратора' });
        }
        
        const notificationId = parseInt(req.params.id);
        const data = await readNotifications();
        const notificationIndex = data.notifications.findIndex(n => n.id === notificationId);
        
        if (notificationIndex === -1) {
            return res.status(404).json({ error: 'Уведомление не найдено' });
        }
        
        data.notifications.splice(notificationIndex, 1);
        await writeNotifications(data);
        
        res.json({ success: true, message: 'Уведомление удалено' });
        
    } catch (error) {
        console.error('Error deleting notification:', error);
        res.status(500).json({ error: 'Ошибка удаления уведомления' });
    }
});

// 📧 PUSH УВЕДОМЛЕНИЯ - API

// Получить VAPID public key
app.get('/api/push/public-key', (req, res) => {
    res.json({ 
        publicKey: vapidKeys.publicKey 
    });
});

// Подписаться на Push уведомления
app.post('/api/push/subscribe', authenticate, (req, res) => {
    try {
        const subscription = req.body;
        const userId = req.user.login;
        
        pushSubscriptions.set(userId, subscription);
        savePushSubscriptions();
        
        console.log(`✅ Push subscription saved for user: ${userId}`);
        res.json({ 
            success: true, 
            message: 'Подписка сохранена',
            subscriptionsCount: pushSubscriptions.size
        });
    } catch (error) {
        console.error('Push subscription error:', error);
        res.status(500).json({ error: 'Ошибка сохранения подписки' });
    }
});

// Отписаться от Push уведомлений
app.post('/api/push/unsubscribe', authenticate, (req, res) => {
    try {
        const userId = req.user.login;
        
        if (pushSubscriptions.has(userId)) {
            pushSubscriptions.delete(userId);
            savePushSubscriptions();
            console.log(`✅ Push subscription removed for user: ${userId}`);
        }
        
        res.json({ 
            success: true, 
            message: 'Подписка удалена',
            subscriptionsCount: pushSubscriptions.size
        });
    } catch (error) {
        console.error('Push unsubscribe error:', error);
        res.status(500).json({ error: 'Ошибка удаления подписки' });
    }
});

// Отправить тестовое Push уведомление
app.post('/api/push/test', authenticate, (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Доступ запрещен' });
    }

    const { title = 'Тестовое уведомление', message = 'Это тестовое Push-уведомление' } = req.body;
    const sentCount = sendPushToAll(title, message);
    
    res.json({ 
        success: true, 
        message: 'Тестовое уведомление отправлено',
        sentCount: sentCount,
        totalSubscriptions: pushSubscriptions.size
    });
});

// Отправить Push уведомление конкретному пользователю
app.post('/api/push/send', authenticate, (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Доступ запрещен' });
    }

    const { userId, title, message, url = '/' } = req.body;
    
    if (!userId || !title) {
        return res.status(400).json({ error: 'userId и title обязательны' });
    }
    
    const success = sendPushToUser(userId, title, message, url);
    
    res.json({ 
        success: success,
        message: success ? 'Уведомление отправлено' : 'Пользователь не подписан на уведомления',
        userId: userId
    });
});

// Получить статистику подписок
app.get('/api/push/stats', authenticate, (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Доступ запрещен' });
    }

    res.json({
        totalSubscriptions: pushSubscriptions.size,
        subscribedUsers: Array.from(pushSubscriptions.keys()),
        vapidPublicKey: vapidKeys.publicKey.substring(0, 20) + '...'
    });
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'Сервер работает',
        timestamp: new Date().toISOString(),
        pushSubscriptions: pushSubscriptions.size,
        pushEnabled: true
    });
});

// Статические файлы
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Загружаем подписки при старте сервера
loadPushSubscriptions();

// Запуск сервера
app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`🌐 Ссылка: http://localhost:${PORT}`);
    console.log(`🔐 Тестовые пользователи:`);
    console.log(`   Админ: login: admin, password: admin`);
    console.log(`   Студент: login: student, password: student`);
    console.log(`📱 Push уведомления: ${pushSubscriptions.size} подписок загружено`);
    console.log(`🔑 VAPID Public Key: ${vapidKeys.publicKey.substring(0, 20)}...`);
});
