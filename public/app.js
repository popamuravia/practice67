console.log('🔥 StudentNotify загружен');

let currentUser = null;
let authToken = null;

async function login() {
    const loginValue = document.getElementById('login').value.trim();
    const passwordValue = document.getElementById('password').value.trim();
    
    console.log('🚀 Попытка входа:', loginValue);
    
    if (!loginValue || !passwordValue) {
        alert('❌ Пожалуйста, заполните все поля');
        return;
    }
    
    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                login: loginValue,
                password: passwordValue
            })
        });
        
        console.log('📊 Статус ответа:', response.status);
        
        if (!response.ok) {
            throw new Error(`Ошибка сервера: ${response.status}`);
        }
        
        const result = await response.json();
        console.log('✅ Ответ сервера:', result);
        
        if (result.error) {
            throw new Error(result.error);
        }
        
        authToken = result.token;
        currentUser = result.user;
        localStorage.setItem('authToken', authToken);
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
        
        console.log('💾 Данные сохранены');
        
        showMainInterface();
        
    } catch (error) {
        console.error('💥 Ошибка входа:', error);
        alert('Ошибка входа: ' + error.message);
    }
}

function logout() {
    console.log('🚪 Выход из системы');
    authToken = null;
    currentUser = null;
    localStorage.removeItem('authToken');
    localStorage.removeItem('currentUser');
    showLoginForm();
}

function checkAuth() {
    console.log('🔍 Проверка авторизации...');
    
    const savedToken = localStorage.getItem('authToken');
    const savedUser = localStorage.getItem('currentUser');
    
    console.log('📦 Сохраненные данные:', { 
        token: savedToken ? 'ЕСТЬ' : 'НЕТ', 
        user: savedUser ? 'ЕСТЬ' : 'НЕТ' 
    });
    
    if (savedToken && savedUser) {
        try {
            authToken = savedToken;
            currentUser = JSON.parse(savedUser);
            console.log('✅ Автовход для:', currentUser.name);
            showMainInterface();
        } catch (error) {
            console.error('❌ Ошибка восстановления сессии:', error);
            showLoginForm();
        }
    } else {
        console.log('❌ Нет сохраненной сессии');
        showLoginForm();
    }
}

function showMainInterface() {
    console.log('🖥️ Показ основного интерфейса для:', currentUser.name);
    
    document.getElementById('login-form').classList.add('hidden');
    document.getElementById('main-interface').classList.remove('hidden');
    
    const userInfo = document.getElementById('user-info');
    const roleIcon = currentUser.role === 'admin' ? '👨‍💼' : '👨‍🎓';
    const roleText = currentUser.role === 'admin' ? 'Администратор' : 'Студент';
    userInfo.textContent = `${roleIcon} ${currentUser.name} (${roleText})`;
    
    if (currentUser.role === 'admin') {
        document.getElementById('admin-panel').classList.remove('hidden');
        console.log('✅ Панель администратора показана');
    } else {
        document.getElementById('admin-panel').classList.add('hidden');
        console.log('✅ Панель администратора скрыта');
    }
    
    loadNotifications();
}

function showLoginForm() {
    console.log('🔐 Показ формы входа');
    
    document.getElementById('login-form').classList.remove('hidden');
    document.getElementById('main-interface').classList.add('hidden');
}

async function apiRequest(url, options = {}) {
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers
    };
    
    if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
    }
    
    try {
        console.log('🌐 API запрос:', url);
        
        const response = await fetch(url, {
            ...options,
            headers
        });
        
        console.log('📡 Статус ответа:', response.status);
        
        if (!response.ok) {
            throw new Error(`HTTP ошибка: ${response.status}`);
        }
        
        return await response.json();
        
    } catch (error) {
        console.error('❌ Ошибка API:', error);
        throw new Error('Не удалось подключиться к серверу: ' + error.message);
    }
}

async function loadNotifications() {
    try {
        console.log('📥 Загрузка уведомлений...');
        
        const data = await apiRequest('/api/notifications');
        console.log('✅ Уведомления загружены:', data.length);
        
        displayNotifications(data);
        
    } catch (error) {
        console.error('❌ Ошибка загрузки уведомлений:', error);
        const container = document.getElementById('notifications-container');
        container.innerHTML = `
            <div style="color: red; text-align: center; padding: 20px;">
                <h3>Ошибка загрузки уведомлений</h3>
                <p>${error.message}</p>
                <button onclick="loadNotifications()" style="padding: 10px; margin: 10px;">
                    Попробовать снова
                </button>
            </div>
        `;
    }
}

function displayNotifications(notifications) {
    const container = document.getElementById('notifications-container');
    
    if (!notifications || notifications.length === 0) {
        container.innerHTML = `
            <div class="card empty-state">
                <div class="icon">📭</div>
                <h3>Уведомлений пока нет</h3>
                <p>Когда появятся новые уведомления, они отобразятся здесь</p>
            </div>
        `;
        return;
    }
    
    const isAdmin = currentUser && currentUser.role === 'admin';
    
    container.innerHTML = notifications.map(notification => `
        <div class="card notification-card ${notification.is_important ? 'important' : ''}">
            <div class="notification-header">
                <div>
                    <h3 class="notification-title">${notification.title}</h3>
                </div>
                ${notification.is_important ? 
                    '<span class="notification-badge">❗ Важно</span>' : 
                    '<span class="notification-badge">📌 Обычное</span>'
                }
            </div>
            
            <div class="notification-content">
                ${notification.content}
            </div>
            
            <div class="notification-meta">
                <div class="meta-left">
                    <span class="meta-item">👤 ${notification.author}</span>
                    <span class="meta-item">📅 ${new Date(notification.created_at).toLocaleString()}</span>
                    ${notification.tags && notification.tags.length > 0 ? `
                        <div class="tags">
                            ${notification.tags.map(tag => `<span class="tag">🏷️ ${tag}</span>`).join('')}
                        </div>
                    ` : ''}
                </div>
                
                ${isAdmin ? `
                    <button class="btn btn-danger btn-sm" onclick="deleteNotification(${notification.id})">
                        🗑️ Удалить
                    </button>
                ` : ''}
            </div>
        </div>
    `).join('');
}

async function createNotification() {
    const title = document.getElementById('notification-title').value.trim();
    const content = document.getElementById('notification-content').value.trim();
    const is_important = document.getElementById('notification-important').checked;
    
    if (!title || !content) {
        alert('❌ Пожалуйста, заполните заголовок и содержание');
        return;
    }
    
    try {
        await apiRequest('/api/notifications', {
            method: 'POST',
            body: JSON.stringify({
                title,
                content,
                is_important,
                tags: ['общее']
            })
        });
        
        document.getElementById('notification-title').value = '';
        document.getElementById('notification-content').value = '';
        document.getElementById('notification-important').checked = false;
        
        loadNotifications();
        alert('✅ Уведомление успешно создано!');
        
    } catch (error) {
        alert('❌ Ошибка создания: ' + error.message);
    }
}

async function deleteNotification(id) {
    if (!confirm('Удалить это уведомление?')) return;
    
    try {
        await apiRequest(`/api/notifications/${id}`, {
            method: 'DELETE'
        });
        
        loadNotifications();
        alert('✅ Уведомление удалено!');
        
    } catch (error) {
        alert('❌ Ошибка удаления: ' + error.message);
    }
}

function setupEnterHandlers() {
    const loginInput = document.getElementById('login');
    const passwordInput = document.getElementById('password');
    
    if (loginInput) {
        loginInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') login();
        });
    }
    
    if (passwordInput) {
        passwordInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') login();
        });
    }
    
    console.log('✅ Обработчики Enter настроены');
}

document.addEventListener('DOMContentLoaded', function() {
    console.log('🎯 Страница загружена, инициализация...');
    setupEnterHandlers();
    checkAuth();
});

window.login = login;
window.logout = logout;
window.createNotification = createNotification;
window.deleteNotification = deleteNotification;

window.loadNotifications = loadNotifications;
