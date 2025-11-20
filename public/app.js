console.log('🔥 StudentNotify загружен');

let currentUser = null;
let authToken = null;
let allNotifications = [];
let currentFilters = {
    searchText: '',
    category: 'all',
    priority: 'all',
    importance: 'all',
    author: 'all',
    dateFrom: '',
    dateTo: ''
};

let pendingFilters = {...currentFilters};

// 📧 PUSH УВЕДОМЛЕНИЯ - Менеджер
class PushManager {
    constructor() {
        this.isSupported = 'serviceWorker' in navigator && 'PushManager' in window;
        this.isSubscribed = false;
        this.swRegistration = null;
        console.log('📱 Push Manager инициализирован, поддержка:', this.isSupported);
    }

    // Инициализация Push
    async init() {
        if (!this.isSupported) {
            console.log('❌ Push notifications not supported');
            return false;
        }

        try {
            // Регистрируем Service Worker
            this.swRegistration = await navigator.serviceWorker.register('/sw.js');
            console.log('✅ Service Worker registered');

            // Ждем активации Service Worker
            await this.waitForServiceWorker();
            
            // Проверяем существующую подписку
            await this.checkExistingSubscription();
            
            return true;
        } catch (error) {
            console.error('❌ Push initialization failed:', error);
            return false;
        }
    }

    // Ожидание активации Service Worker
    async waitForServiceWorker() {
        return new Promise((resolve) => {
            if (this.swRegistration.active) {
                resolve();
            } else {
                this.swRegistration.addEventListener('activate', () => resolve());
            }
        });
    }

    // Проверка существующей подписки
    async checkExistingSubscription() {
        try {
            const subscription = await this.swRegistration.pushManager.getSubscription();
            if (subscription) {
                this.isSubscribed = true;
                await this.sendSubscriptionToServer(subscription);
                console.log('✅ Существующая подписка найдена');
            }
        } catch (error) {
            console.error('❌ Ошибка проверки подписки:', error);
        }
    }

    // Подписка на Push
    async subscribeToPush() {
        try {
            // Запрашиваем разрешение
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
                throw new Error('Пользователь отказал в разрешении');
            }

            // Получаем VAPID public key с сервера
            const response = await fetch('/api/push/public-key');
            const { publicKey } = await response.json();
            
            console.log('🔑 Получен VAPID ключ с сервера');

            // Создаем новую подписку
            const subscription = await this.swRegistration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: this.urlBase64ToUint8Array(publicKey)
            });

            this.isSubscribed = true;
            await this.sendSubscriptionToServer(subscription);
            
            console.log('✅ Подписка на Push создана');
            return subscription;
            
        } catch (error) {
            console.error('❌ Push subscription failed:', error);
            throw error;
        }
    }

    // Отписка от Push
    async unsubscribeFromPush() {
        try {
            const subscription = await this.swRegistration.pushManager.getSubscription();
            if (subscription) {
                await subscription.unsubscribe();
                this.isSubscribed = false;
                
                // Удаляем подписку с сервера
                await this.removeSubscriptionFromServer();
                
                console.log('✅ Подписка отменена');
            }
        } catch (error) {
            console.error('❌ Push unsubscription failed:', error);
            throw error;
        }
    }

    // Отправка подписки на сервера
    async sendSubscriptionToServer(subscription) {
        try {
            const response = await fetch('/api/push/subscribe', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify(subscription)
            });

            if (!response.ok) {
                throw new Error(`HTTP error: ${response.status}`);
            }

            const result = await response.json();
            console.log('✅ Подписка сохранена на сервере');
            return result;
            
        } catch (error) {
            console.error('❌ Error saving subscription:', error);
            throw error;
        }
    }

    // Удаление подписки с сервера
    async removeSubscriptionFromServer() {
        try {
            const response = await fetch('/api/push/unsubscribe', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${authToken}`
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP error: ${response.status}`);
            }

            console.log('✅ Подписка удалена с сервера');
        } catch (error) {
            console.error('❌ Error removing subscription:', error);
        }
    }

    // Вспомогательная функция для конвертации ключа
    urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding)
            .replace(/\-/g, '+')
            .replace(/_/g, '/');

        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);

        for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
    }
}

// Инициализация Push Manager
const pushManager = new PushManager();

// 🔐 СИСТЕМА АВТОРИЗАЦИИ
async function login() {
    const loginValue = document.getElementById('login').value.trim();
    const passwordValue = document.getElementById('password').value.trim();
    
    console.log('🚀 Попытка входа:', loginValue);
    
    if (!loginValue || !passwordValue) {
        showTempMessage('❌ Пожалуйста, заполните все поля', 'error');
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
            const errorData = await response.json().catch(() => ({ error: 'Ошибка сервера' }));
            throw new Error(errorData.error || `Ошибка сервера: ${response.status}`);
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
        
        await showMainInterface();
        
    } catch (error) {
        console.error('💥 Ошибка входа:', error);
        showTempMessage('Ошибка входа: ' + error.message, 'error');
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

// 🎨 УПРАВЛЕНИЕ ИНТЕРФЕЙСОМ
async function showMainInterface() {
    console.log('🖥️ Показ основного интерфейса для:', currentUser.name);
    
    document.getElementById('login-form').classList.add('hidden');
    document.getElementById('main-interface').classList.remove('hidden');
    
    const userInfo = document.getElementById('user-info');
    const roleIcon = currentUser.role === 'admin' ? '👨‍💼' : '👨‍🎓';
    const roleText = currentUser.role === 'admin' ? 'Администратор' : 'Студент';
    userInfo.textContent = `${roleIcon} ${currentUser.name} (${roleText})`;
    
    // Настройка панели администратора
    if (currentUser.role === 'admin') {
        document.getElementById('admin-panel').classList.remove('hidden');
        document.getElementById('push-admin-panel').classList.remove('hidden');
        console.log('✅ Панель администратора показана');
    } else {
        document.getElementById('admin-panel').classList.add('hidden');
        document.getElementById('push-admin-panel').classList.add('hidden');
        console.log('✅ Панель администратора скрыта');
    }
    
    // Инициализация Push уведомлений
    if (pushManager.isSupported) {
        console.log('📱 Инициализация Push уведомлений...');
        const pushSuccess = await pushManager.init();
        if (pushSuccess) {
            updatePushUI();
        }
    } else {
        console.log('❌ Браузер не поддерживает Push уведомления');
        document.getElementById('push-admin-panel').classList.add('hidden');
    }
    
    initializeSearch();
    await loadNotifications();
}

function showLoginForm() {
    console.log('🔐 Показ формы входа');
    
    document.getElementById('login-form').classList.remove('hidden');
    document.getElementById('main-interface').classList.add('hidden');
    document.getElementById('admin-panel').classList.add('hidden');
    document.getElementById('push-admin-panel').classList.add('hidden');
}

// 📢 СИСТЕМА УВЕДОМЛЕНИЙ
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
            const errorText = await response.text();
            throw new Error(`HTTP ошибка: ${response.status} - ${errorText}`);
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
        
        allNotifications = data;
        
        if (!window.searchInitialized) {
            initializeSearch();
            window.searchInitialized = true;
        }
        
        applyFilters();
        
    } catch (error) {
        console.error('❌ Ошибка загрузки уведомлений:', error);
        const container = document.getElementById('notifications-container');
        container.innerHTML = `
            <div class="card" style="color: red; text-align: center; padding: 20px;">
                <h3>Ошибка загрузки уведомлений</h3>
                <p>${error.message}</p>
                <button onclick="loadNotifications()" class="btn btn-primary" style="margin-top: 15px;">
                    Попробовать снова
                </button>
            </div>
        `;
    }
}

function displayFilteredNotifications(notifications) {
    const container = document.getElementById('notifications-container');
    
    if (notifications.length === 0) {
        container.innerHTML = `
            <div class="card empty-state">
                <div class="icon">🔍</div>
                <h3>Ничего не найдено</h3>
                <p>Попробуйте изменить параметры поиска или фильтры</p>
                <button onclick="clearFilters()" class="btn btn-primary" style="margin-top: 15px;">
                    Сбросить фильтры
                </button>
            </div>
        `;
        return;
    }
    
    const isAdmin = currentUser && currentUser.role === 'admin';
    
    container.innerHTML = notifications.map(notification => {
        const getCategoryClass = (category) => {
            const categoryMap = {
                'общее': 'category-general',
                'расписание': 'category-schedule',
                'учеба': 'category-studies',
                'мероприятия': 'category-events',
                'техническое': 'category-technical',
                'срочное': 'category-urgent'
            };
            return categoryMap[category] || 'category-general';
        };
        
        const getPriorityClass = (priority) => {
            const priorityMap = {
                'critical': 'priority-critical',
                'high': 'priority-high',
                'medium': 'priority-medium',
                'low': 'priority-low'
            };
            return priorityMap[priority] || 'priority-medium';
        };
        
        const getPriorityText = (priority) => {
            const textMap = {
                'critical': 'Критический',
                'high': 'Высокий',
                'medium': 'Средний',
                'low': 'Низкий'
            };
            return textMap[priority] || 'Средний';
        };
        
        let highlightedTitle = notification.title;
        let highlightedContent = notification.content;
        
        if (currentFilters.searchText) {
            const regex = new RegExp(`(${escapeRegExp(currentFilters.searchText)})`, 'gi');
            highlightedTitle = notification.title.replace(regex, '<span class="highlight">$1</span>');
            highlightedContent = notification.content.replace(regex, '<span class="highlight">$1</span>');
        }
        
        return `
        <div class="card notification-card ${notification.is_important ? 'important' : ''}">
            <div class="notification-header">
                <div class="notification-title-section">
                    <h3 class="notification-title">${highlightedTitle}</h3>
                </div>
                <div class="notification-meta-badges">
                    <span class="category-badge ${getCategoryClass(notification.category)}">
                        ${notification.category}
                    </span>
                    <span class="priority-badge ${getPriorityClass(notification.priority)}">
                        ${getPriorityText(notification.priority)}
                    </span>
                    ${notification.is_important ? 
                        '<span class="notification-badge">❗ Важно</span>' : 
                        '<span class="notification-badge">📌 Обычное</span>'
                    }
                </div>
            </div>
            
            <div class="notification-content">
                ${highlightedContent}
            </div>
            
            ${notification.tags && notification.tags.length > 0 ? `
                <div class="tags-cloud">
                    ${notification.tags.map(tag => `
                        <span class="tag" onclick="searchByTag('${tag}')">🏷️ ${tag}</span>
                    `).join('')}
                </div>
            ` : ''}
            
            <div class="notification-meta">
                <div class="meta-left">
                    <span class="meta-item">👤 ${notification.author}</span>
                    <span class="meta-item">📅 ${new Date(notification.created_at).toLocaleString()}</span>
                </div>
                
                ${isAdmin ? `
                    <button class="btn btn-danger btn-sm" onclick="deleteNotification(${notification.id})">
                        🗑️ Удалить
                    </button>
                ` : ''}
            </div>
        </div>
        `;
    }).join('');
}

async function createNotification() {
    console.log('📝 Попытка создания уведомления');
    
    const title = document.getElementById('notification-title').value.trim();
    const content = document.getElementById('notification-content').value.trim();
    const is_important = document.getElementById('notification-important').checked;
    const category = document.getElementById('notification-category').value;
    const priority = document.getElementById('notification-priority').value;
    const tagsInput = document.getElementById('notification-tags').value.trim();
    const send_push = document.getElementById('notification-push').checked;
    
    console.log('📋 Данные формы:', {
        title,
        contentLength: content.length,
        is_important,
        category,
        priority,
        tagsInput,
        send_push
    });
    
    if (!title) {
        showTempMessage('❌ Пожалуйста, введите заголовок уведомления', 'error');
        document.getElementById('notification-title').focus();
        return;
    }
    
    if (!content) {
        showTempMessage('❌ Пожалуйста, введите содержание уведомления', 'error');
        document.getElementById('notification-content').focus();
        return;
    }
    
    if (content.length < 5) {
        showTempMessage('❌ Содержание уведомления должно быть не менее 5 символов', 'error');
        document.getElementById('notification-content').focus();
        return;
    }
    
    try {
        console.log('📡 Отправка запроса на создание уведомления...');
        
        let tags = [];
        if (tagsInput) {
            tags = tagsInput.split(',')
                .map(tag => tag.trim())
                .filter(tag => tag.length > 0);
        }
        
        const response = await fetch('/api/notifications', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
                title,
                content,
                is_important,
                category,
                priority,
                tags,
                send_push: send_push || is_important
            })
        });
        
        console.log('📊 Статус ответа:', response.status);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ Ошибка сервера:', errorText);
            throw new Error(`Ошибка сервера: ${response.status}`);
        }
        
        const result = await response.json();
        console.log('✅ Уведомление создано:', result);
        
        // Очистка формы
        document.getElementById('notification-title').value = '';
        document.getElementById('notification-content').value = '';
        document.getElementById('notification-important').checked = false;
        document.getElementById('notification-category').value = 'общее';
        document.getElementById('notification-priority').value = 'medium';
        document.getElementById('notification-tags').value = '';
        document.getElementById('notification-push').checked = false;
        
        showTempMessage('✅ Уведомление успешно создано!', 'success');
        
        // Перезагрузка уведомлений
        setTimeout(() => {
            loadNotifications();
        }, 1000);
        
    } catch (error) {
        console.error('💥 Ошибка создания уведомления:', error);
        showTempMessage('❌ Ошибка создания уведомления: ' + error.message, 'error');
    }
}

async function deleteNotification(id) {
    if (!confirm('Удалить это уведомление?')) return;
    
    try {
        await apiRequest(`/api/notifications/${id}`, {
            method: 'DELETE'
        });
        
        showTempMessage('✅ Уведомление удалено!', 'success');
        await loadNotifications();
        
    } catch (error) {
        showTempMessage('❌ Ошибка удаления: ' + error.message, 'error');
    }
}

// 🔍 СИСТЕМА ПОИСКА И ФИЛЬТРАЦИИ
function initializeSearch() {
    console.log('🔍 Инициализация поиска и фильтров');
    
    // Поиск по вводу
    document.getElementById('search-input').addEventListener('input', function(e) {
        pendingFilters.searchText = e.target.value.toLowerCase();
        updatePreviewStats();
    });
    
    // Фильтры
    const filterIds = [
        'filter-category', 'filter-priority', 'filter-importance', 
        'filter-author', 'filter-date-from', 'filter-date-to'
    ];
    
    filterIds.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener('change', function(e) {
                pendingFilters[id.replace('filter-', '')] = e.target.value;
                updatePreviewStats();
            });
        }
    });
    
    // Кнопка применения фильтров
    const applyBtn = document.getElementById('apply-filters');
    if (applyBtn) {
        applyBtn.addEventListener('click', applyFilters);
    }
    
    updateFilterIndicators();
}

function applyFilters() {
    console.log('🎯 Применение фильтров:', pendingFilters);
    
    currentFilters = {...pendingFilters};
    
    if (allNotifications.length === 0) {
        console.log('❌ Нет уведомлений для фильтрации');
        updateSearchStats(0, 0);
        return;
    }
    
    const filteredNotifications = allNotifications.filter(notification => {
        const matchesSearch = currentFilters.searchText === '' || 
            notification.title.toLowerCase().includes(currentFilters.searchText) ||
            notification.content.toLowerCase().includes(currentFilters.searchText) ||
            (notification.tags && notification.tags.some(tag => 
                tag.toLowerCase().includes(currentFilters.searchText)
            ));
        
        const matchesCategory = currentFilters.category === 'all' ||
            notification.category === currentFilters.category;
        
        const matchesPriority = currentFilters.priority === 'all' ||
            notification.priority === currentFilters.priority;
        
        const matchesImportance = currentFilters.importance === 'all' ||
            (currentFilters.importance === 'important' && notification.is_important) ||
            (currentFilters.importance === 'normal' && !notification.is_important);
        
        const matchesAuthor = currentFilters.author === 'all' ||
            notification.author === currentFilters.author;
        
        let matchesDate = true;
        if (currentFilters.dateFrom) {
            const notificationDate = new Date(notification.created_at);
            const filterDateFrom = new Date(currentFilters.dateFrom);
            matchesDate = matchesDate && notificationDate >= filterDateFrom;
        }
        
        if (currentFilters.dateTo) {
            const notificationDate = new Date(notification.created_at);
            const filterDateTo = new Date(currentFilters.dateTo);
            filterDateTo.setHours(23, 59, 59, 999);
            matchesDate = matchesDate && notificationDate <= filterDateTo;
        }
        
        return matchesSearch && matchesCategory && matchesPriority && 
               matchesImportance && matchesAuthor && matchesDate;
    });
    
    console.log(`📊 Результаты фильтрации: ${filteredNotifications.length} из ${allNotifications.length}`);
    
    updateSearchStats(filteredNotifications.length, allNotifications.length);
    displayFilteredNotifications(filteredNotifications);
    updateFilterIndicators();
    
    showTempMessage('✅ Фильтры применены!', 'success');
}

function updateFilterIndicators() {
    const categorySelect = document.getElementById('filter-category');
    const prioritySelect = document.getElementById('filter-priority');
    const importanceSelect = document.getElementById('filter-importance');
    const authorSelect = document.getElementById('filter-author');
    const dateFromInput = document.getElementById('filter-date-from');
    const dateToInput = document.getElementById('filter-date-to');
    
    [categorySelect, prioritySelect, importanceSelect, authorSelect, dateFromInput, dateToInput]
        .forEach(el => el?.classList.remove('filter-active'));
    
    if (pendingFilters.category !== 'all') categorySelect?.classList.add('filter-active');
    if (pendingFilters.priority !== 'all') prioritySelect?.classList.add('filter-active');
    if (pendingFilters.importance !== 'all') importanceSelect?.classList.add('filter-active');
    if (pendingFilters.author !== 'all') authorSelect?.classList.add('filter-active');
    if (pendingFilters.dateFrom) dateFromInput?.classList.add('filter-active');
    if (pendingFilters.dateTo) dateToInput?.classList.add('filter-active');
    
    updatePreviewStats();
}

function updatePreviewStats() {
    if (allNotifications.length === 0) return;
    
    const previewCount = calculatePreviewCount();
    const statsElement = document.getElementById('search-stats');
    
    if (statsElement) {
        const filtersAreEqual = JSON.stringify(pendingFilters) === JSON.stringify(currentFilters);
        
        if (filtersAreEqual) {
            statsElement.innerHTML = `Показано <span id="shown-count">${previewCount}</span> из <span id="total-count">${allNotifications.length}</span> уведомлений`;
        } else {
            const changes = getFilterChanges();
            statsElement.innerHTML = `
                <div style="color: #e67e22; font-weight: bold;">⚡ Фильтры не применены</div>
                <div style="font-size: 0.9rem; margin-top: 5px;">
                    Будет показано: ${previewCount} из ${allNotifications.length}
                    ${changes ? `<br>Изменения: ${changes}` : ''}
                </div>
            `;
        }
    }
}

function calculatePreviewCount() {
    if (allNotifications.length === 0) return 0;
    
    return allNotifications.filter(notification => {
        const matchesSearch = pendingFilters.searchText === '' || 
            notification.title.toLowerCase().includes(pendingFilters.searchText) ||
            notification.content.toLowerCase().includes(pendingFilters.searchText);
        
        const matchesCategory = pendingFilters.category === 'all' ||
            notification.category === pendingFilters.category;
        
        const matchesPriority = pendingFilters.priority === 'all' ||
            notification.priority === pendingFilters.priority;
        
        const matchesImportance = pendingFilters.importance === 'all' ||
            (pendingFilters.importance === 'important' && notification.is_important) ||
            (pendingFilters.importance === 'normal' && !notification.is_important);
        
        const matchesAuthor = pendingFilters.author === 'all' ||
            notification.author === pendingFilters.author;
        
        let matchesDate = true;
        if (pendingFilters.dateFrom) {
            const notificationDate = new Date(notification.created_at);
            const filterDateFrom = new Date(pendingFilters.dateFrom);
            matchesDate = matchesDate && notificationDate >= filterDateFrom;
        }
        
        if (pendingFilters.dateTo) {
            const notificationDate = new Date(notification.created_at);
            const filterDateTo = new Date(pendingFilters.dateTo);
            filterDateTo.setHours(23, 59, 59, 999);
            matchesDate = matchesDate && notificationDate <= filterDateTo;
        }
        
        return matchesSearch && matchesCategory && matchesPriority && matchesImportance && matchesAuthor && matchesDate;
    }).length;
}

function getFilterChanges() {
    const changes = [];
    
    if (pendingFilters.category !== currentFilters.category) {
        changes.push(`категория: ${pendingFilters.category}`);
    }
    if (pendingFilters.priority !== currentFilters.priority) {
        changes.push(`приоритет: ${pendingFilters.priority}`);
    }
    if (pendingFilters.importance !== currentFilters.importance) {
        changes.push(`важность: ${pendingFilters.importance}`);
    }
    if (pendingFilters.author !== currentFilters.author) {
        changes.push(`автор: ${pendingFilters.author}`);
    }
    if (pendingFilters.dateFrom !== currentFilters.dateFrom) {
        changes.push(`дата с: ${pendingFilters.dateFrom || 'не установлена'}`);
    }
    if (pendingFilters.dateTo !== currentFilters.dateTo) {
        changes.push(`дата по: ${pendingFilters.dateTo || 'не установлена'}`);
    }
    
    return changes.join(', ');
}

function updateSearchStats(shown, total) {
    const statsElement = document.getElementById('search-stats');
    const shownCountElement = document.getElementById('shown-count');
    const totalCountElement = document.getElementById('total-count');
    
    console.log(`📊 Обновление статистики: ${shown} из ${total}`);
    
    if (statsElement && shownCountElement && totalCountElement) {
        shownCountElement.textContent = shown;
        totalCountElement.textContent = total;
        
        const filtersAreApplied = JSON.stringify(pendingFilters) === JSON.stringify(currentFilters);
        const hasActiveFilters = !isDefaultFilters(currentFilters);
        
        statsElement.className = 'search-stats';
        
        if (shown === 0 && total > 0) {
            statsElement.innerHTML = `
                <div style="color: #e74c3c; font-weight: bold;">🔍 Уведомления не найдены</div>
                <div style="font-size: 0.8rem; margin-top: 5px;">Попробуйте изменить параметры поиска</div>
            `;
            statsElement.classList.add('warning');
        } else if (shown === total && !hasActiveFilters) {
            statsElement.innerHTML = `Все уведомления: <span id="shown-count">${total}</span>`;
            statsElement.classList.add('success');
        } else if (shown === total && hasActiveFilters) {
            statsElement.innerHTML = `Показаны все <span id="shown-count">${shown}</span> уведомлений`;
            statsElement.classList.add('success');
        } else if (!filtersAreApplied) {
            statsElement.innerHTML = `
                <div style="color: #e67e22; font-weight: bold;">⚡ Фильтры не применены</div>
                <div style="font-size: 0.8rem; margin-top: 3px;">Будет показано: <strong>${shown}</strong> из ${total}</div>
                <div style="font-size: 0.75rem; margin-top: 2px; color: #888;">Нажмите "Применить"</div>
            `;
            statsElement.classList.add('warning');
        } else {
            statsElement.innerHTML = `Показано <span id="shown-count">${shown}</span> из <span id="total-count">${total}</span> уведомлений`;
            statsElement.classList.add('success');
        }
    }
}

function isDefaultFilters(filters) {
    return filters.searchText === '' &&
           filters.category === 'all' &&
           filters.priority === 'all' &&
           filters.importance === 'all' &&
           filters.author === 'all' &&
           filters.dateFrom === '' &&
           filters.dateTo === '';
}

function clearFilters() {
    console.log('🗑️ Очистка всех фильтров');
    
    document.getElementById('search-input').value = '';
    document.getElementById('filter-category').value = 'all';
    document.getElementById('filter-priority').value = 'all';
    document.getElementById('filter-importance').value = 'all';
    document.getElementById('filter-author').value = 'all';
    document.getElementById('filter-date-from').value = '';
    document.getElementById('filter-date-to').value = '';
    
    currentFilters = {
        searchText: '',
        category: 'all',
        priority: 'all',
        importance: 'all',
        author: 'all',
        dateFrom: '',
        dateTo: ''
    };
    pendingFilters = {...currentFilters};
    
    if (allNotifications.length > 0) {
        displayFilteredNotifications(allNotifications);
        setTimeout(() => {
            updateSearchStats(allNotifications.length, allNotifications.length);
        }, 100);
    } else {
        updateSearchStats(0, 0);
    }
    
    updateFilterIndicators();
    showTempMessage('🗑️ Все фильтры очищены!', 'success');
}

function searchByTag(tag) {
    console.log(`🔍 Поиск по тегу: ${tag}`);
    
    document.getElementById('search-input').value = tag;
    pendingFilters.searchText = tag.toLowerCase();
    applyFilters();
    
    document.querySelector('.search-filters-panel').scrollIntoView({ 
        behavior: 'smooth' 
    });
}

// 📧 PUSH УВЕДОМЛЕНИЯ - UI Функции
function updatePushUI() {
    const statusElement = document.getElementById('push-status');
    const toggleBtn = document.getElementById('push-toggle-btn');
    const testBtn = document.getElementById('push-test-btn');
    
    if (!statusElement || !toggleBtn) return;
    
    const isAdmin = currentUser && currentUser.role === 'admin';
    
    // Показываем/скрываем кнопку теста для админов
    if (testBtn) {
        testBtn.style.display = isAdmin ? 'inline-block' : 'none';
    }
    
    if (pushManager.isSubscribed) {
        statusElement.innerHTML = '<span class="status-dot online"></span><span>Уведомления включены</span>';
        toggleBtn.textContent = 'Отключить уведомления';
        toggleBtn.className = 'btn btn-danger';
    } else {
        statusElement.innerHTML = '<span class="status-dot offline"></span><span>Уведомления отключены</span>';
        toggleBtn.textContent = 'Включить уведомления';
        toggleBtn.className = 'btn btn-primary';
    }
}

async function togglePushNotifications() {
    const btn = document.getElementById('push-toggle-btn');
    
    if (!pushManager.isSupported) {
        showTempMessage('Ваш браузер не поддерживает Push-уведомления', 'error');
        return;
    }

    try {
        if (pushManager.isSubscribed) {
            await pushManager.unsubscribeFromPush();
            showTempMessage('Push-уведомления отключены', 'success');
        } else {
            await pushManager.subscribeToPush();
            showTempMessage('Push-уведомления включены', 'success');
        }
        updatePushUI();
    } catch (error) {
        console.error('Push toggle error:', error);
        showTempMessage('Ошибка настройки уведомлений: ' + error.message, 'error');
    }
}

async function testPushNotification() {
    if (currentUser.role !== 'admin') {
        showTempMessage('Только администраторы могут отправлять тестовые уведомления', 'error');
        return;
    }

    try {
        const response = await fetch('/api/push/test', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
                title: 'Тестовое уведомление',
                message: '✅ Push-система работает корректно!'
            })
        });

        const result = await response.json();
        
        if (response.ok) {
            showTempMessage(`Тест отправлен (${result.sentCount} пользователей)`, 'success');
        } else {
            throw new Error(result.error || 'Failed to send test');
        }
    } catch (error) {
        console.error('Test push error:', error);
        showTempMessage('Ошибка отправки теста: ' + error.message, 'error');
    }
}
// 🚀 ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
function showTempMessage(message, type = 'success') {
    const existingMessages = document.querySelectorAll('.temp-message');
    existingMessages.forEach(msg => msg.remove());
    
    const messageDiv = document.createElement('div');
    messageDiv.className = 'temp-message';
    messageDiv.textContent = message;
    messageDiv.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 25px;
        border-radius: 10px;
        color: white;
        font-weight: 600;
        z-index: 10000;
        background: ${type === 'success' ? '#27ae60' : type === 'error' ? '#e74c3c' : '#3498db'};
        box-shadow: 0 6px 20px rgba(0,0,0,0.3);
        border: 2px solid ${type === 'success' ? '#219653' : type === 'error' ? '#c0392b' : '#2980b9'};
        transform: translateX(400px);
        opacity: 0;
        transition: all 0.5s ease;
        max-width: 400px;
        word-wrap: break-word;
    `;
    
    document.body.appendChild(messageDiv);
    
    setTimeout(() => {
        messageDiv.style.transform = 'translateX(0)';
        messageDiv.style.opacity = '1';
    }, 100);
    
    setTimeout(() => {
        messageDiv.style.transform = 'translateX(400px)';
        messageDiv.style.opacity = '0';
        setTimeout(() => {
            if (messageDiv.parentNode) {
                messageDiv.remove();
            }
        }, 500);
    }, 4000);
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 🚀 ИНИЦИАЛИЗАЦИЯ
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

// Глобальные функции для HTML
window.login = login;
window.logout = logout;
window.createNotification = createNotification;
window.deleteNotification = deleteNotification;
window.loadNotifications = loadNotifications;
window.clearFilters = clearFilters;
window.applyFilters = applyFilters;
window.searchByTag = searchByTag;
window.togglePushNotifications = togglePushNotifications;
window.testPushNotification = testPushNotification;
