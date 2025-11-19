const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key';

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

async function readNotifications() {
    try {
        const data = await fs.readFile('./data/notifications.json', 'utf8');
        return JSON.parse(data);
    } catch (error) {
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
                    tags: ["приветствие"]
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

app.post('/api/login', async (req, res) => {
    try {
        const { login, password } = req.body;
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

app.post('/api/notifications', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'Требуется авторизация' });
        
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.role !== 'admin') return res.status(403).json({ error: 'Требуются права администратора' });
        
        const { title, content, is_important = false, tags = [] } = req.body;
        if (!title || !content) return res.status(400).json({ error: 'Заголовок и содержание обязательны' });
        
        const data = await readNotifications();
        const newNotification = {
            id: data.next_id++,
            title,
            content,
            author: decoded.login,
            created_at: new Date().toISOString(),
            is_important,
            tags
        };
        
        data.notifications.push(newNotification);
        await writeNotifications(data);
        
        res.json(newNotification);
        
    } catch (error) {
        console.error('Error creating notification:', error);
        res.status(500).json({ error: 'Ошибка создания уведомления' });
    }
});

app.delete('/api/notifications/:id', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'Требуется авторизация' });
        
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.role !== 'admin') return res.status(403).json({ error: 'Требуются права администратора' });
        
        const notificationId = parseInt(req.params.id);
        const data = await readNotifications();
        const notificationIndex = data.notifications.findIndex(n => n.id === notificationId);
        
        if (notificationIndex === -1) return res.status(404).json({ error: 'Уведомление не найдено' });
        
        data.notifications.splice(notificationIndex, 1);
        await writeNotifications(data);
        
        res.json({ success: true, message: 'Уведомление удалено' });
        
    } catch (error) {
        console.error('Error deleting notification:', error);
        res.status(500).json({ error: 'Ошибка удаления уведомления' });
    }
});

app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'Сервер работает',
        timestamp: new Date().toISOString()
    });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
а
app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`🌐 Ссылка: http://localhost:${PORT}`);

});
