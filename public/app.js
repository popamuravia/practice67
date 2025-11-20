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
let pushManager = null;

// 📧 PUSH УВЕДОМЛЕНИЯ - Менеджер
// 📧 PUSH УВЕДОМЛЕНИЯ - Упрощенный и надежный менеджер
class PushManager {
    constructor() {
        this.isSupported = 'serviceWorker' in navigator && 'PushManager' in window;
        this.isSubscribed = false;
        this.initialized = false;
        this.initializationInProgress = false;
        
        console.log('📱 Push Manager создан, поддержка:', this.isSupported);
        
        // Автоматически инициализируем при создании
        if (this.isSupported) {
            this.initialize();
        } else {
            this.initialized = true;
            this.updateStatus('unsupported', 'Браузер не поддерживает Push-уведомления');
        }
    }

    // Асинхронная инициализация
    async initialize() {
        if (this.initializationInProgress) {
            console.log('🔄 Инициализация уже выполняется...');
            return;
        }

        this.initializationInProgress = true;
        
        try {
            console.log('🚀 Начало инициализации Push...');
            this.updateStatus('pending', 'Инициализация...');

            // 1. Регистрируем Service Worker
            console.log('📝 Регистрация Service Worker...');
            const registration = await navigator.serviceWorker.register('/sw.js');
            console.log('✅ Service Worker зарегистрирован');

            // 2. Ждем пока Service Worker будет готов
            console.log('⏳ Ожидание активации Service Worker...');
            if (registration.active) {
                console.log('✅ Service Worker уже активен');
            } else if (registration.installing) {
                await new Promise((resolve) => {
                    registration.installing.addEventListener('statechange', (e) => {
                        if (e.target.state === 'activated') {
                            console.log('✅ Service Worker активирован');
                            resolve();
                        }
                    });
                });
            } else if (registration.waiting) {
                await new Promise((resolve) => {
                    registration.waiting.addEventListener('statechange', (e) => {
                        if (e.target.state === 'activated') {
                            console.log('✅ Service Worker активирован');
                            resolve();
                        }
                    });
                });
            }

            // 3. Сохраняем регистрацию
            this.swRegistration = registration;

            // 4. Проверяем существующую подписку
            console.log('🔍 Проверка существующей подписки...');
            const subscription = await registration.pushManager.getSubscription();
            
            if (subscription) {
                this.isSubscribed = true;
                this.subscription = subscription;
                console.log('✅ Найдена существующая подписка');
                this.updateStatus('online', 'Уведомления включены');
            } else {
                this.isSubscribed = false;
                console.log('ℹ️ Подписка не найдена');
                this.updateStatus('offline', 'Уведомления отключены');
            }

            this.initialized = true;
            console.log('🎉 Push Manager успешно инициализирован');

        } catch (error) {
            console.error('❌ Ошибка инициализации Push Manager:', error);
            this.updateStatus('offline', 'Ошибка инициализации');
            this.initialized = true; // Все равно помечаем как инициализированный, но с ошибкой
        } finally {
            this.initializationInProgress = false;
        }
    }

    // Подписка на Push
    async subscribeToPush() {
        console.log('🔄 Начало процесса подписки...');
        
        // Проверяем инициализацию
        if (!this.initialized) {
            throw new Error('Push Manager еще не инициализирован. Подождите немного.');
        }

        if (!this.swRegistration) {
            throw new Error('Service Worker не зарегистрирован');
        }

        try {
            this.updateStatus('pending', 'Запрос разрешения...');
            
            // Запрашиваем разрешение
            console.log('📋 Запрос разрешения на уведомления...');
            const permission = await Notification.requestPermission();
            console.log('✅ Результат разрешения:', permission);
            
            if (permission !== 'granted') {
                throw new Error('Пользователь отказал в разрешении на уведомления');
            }

            this.updateStatus('pending', 'Получение ключа...');
            
            // Получаем VAPID public key с сервера
            console.log('🔑 Получение VAPID ключа с сервера...');
            const response = await fetch('/api/push/public-key');
            
            if (!response.ok) {
                throw new Error('Не удалось получить ключ с сервера: ' + response.status);
            }
            
            const keyData = await response.json();
            console.log('✅ Ключ получен');
            
            if (!keyData.publicKey) {
                throw new Error('Ключ не получен от сервера');
            }

            this.updateStatus('pending', 'Создание подписки...');
            console.log('🔧 Создание подписки...');

            // Создаем новую подписку
            this.subscription = await this.swRegistration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: this.urlBase64ToUint8Array(keyData.publicKey)
            });

            this.isSubscribed = true;
            
            // Сохраняем подписку на сервере
            console.log('💾 Сохранение подписки на сервере...');
            await this.sendSubscriptionToServer(this.subscription);
            
            this.updateStatus('online', 'Уведомления включены 🎉');
            console.log('✅ Подписка успешно создана и сохранена');
            
            return this.subscription;
            
        } catch (error) {
            console.error('❌ Ошибка подписки:', error);
            this.updateStatus('offline', 'Ошибка: ' + error.message);
            throw error;
        }
    }

    // Отписка от Push
    async unsubscribeFromPush() {
        console.log('🔄 Начало процесса отписки...');
        
        // Проверяем инициализацию
        if (!this.initialized) {
            throw new Error('Push Manager еще не инициализирован');
        }

        try {
            this.updateStatus('pending', 'Отмена подписки...');
            
            if (this.subscription) {
                console.log('🗑️ Отмена подписки на клиенте...');
                await this.subscription.unsubscribe();
                console.log('✅ Подписка отменена на клиенте');
            }
            
            this.isSubscribed = false;
            this.subscription = null;
            
            // Удаляем подписку с сервера
            console.log('🗑️ Удаление подписки с сервера...');
            await this.removeSubscriptionFromServer();
            
            this.updateStatus('offline', 'Уведомления отключены');
            console.log('✅ Отписка завершена');
            
        } catch (error) {
            console.error('❌ Ошибка отписки:', error);
            this.updateStatus('offline', 'Ошибка отписки');
            throw error;
        }
    }

    // Отправка подписки на сервер
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

            console.log('✅ Подписка сохранена на сервере');
            
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

    // Обновление статуса в UI
    updateStatus(status, message) {
        const statusElement = document.getElementById('push-status');
        const detailsElement = document.getElementById('push-details');
        
        if (!statusElement) {
            console.log('⚠️ Элемент push-status не найден в DOM');
            return;
        }
        
        const dot = statusElement.querySelector('.status-dot');
        const text = statusElement.querySelector('.status-text');
        
        if (!dot || !text) {
            console.log('⚠️ Элементы статуса не найдены');
            return;
        }
        
        // Удаляем все классы статуса
        dot.className = 'status-dot ' + status;
        text.textContent = message;
        
        if (detailsElement) {
            detailsElement.innerHTML = `<small>${this.getStatusDetails(status)}</small>`;
        }
        
        console.log(`📊 Статус Push обновлен: ${status} - ${message}`);
    }

    // Детали статуса
    getStatusDetails(status) {
        const details = {
            'online': 'Вы будете получать уведомления даже когда сайт закрыт',
            'offline': 'Нажмите "Включить уведомления" для активации',
            'pending': 'Выполняется настройка системы уведомлений',
            'unsupported': 'Ваш браузер не поддерживает Push-уведомления'
        };
        return details[status] || 'Неизвестный статус';
    }

    // Вспомогательная функция для конвертации ключа
    urlBase64ToUint8Array(base64String) {
        try {
            const padding = '='.repeat((4 - base64String.length % 4) % 4);
            const base64 = (base64String + padding)
                .replace(/-/g, '+')
                .replace(/_/g, '/');

            const rawData = window.atob(base64);
            const outputArray = new Uint8Array(rawData.length);

            for (let i = 0; i < rawData.length; ++i) {
                outputArray[i] = rawData.charCodeAt(i);
            }
            
            return outputArray;
        } catch (error) {
            console.error('❌ Ошибка конвертации ключа:', error);
            throw new Error('Неверный формат VAPID ключа');
        }
    }
}
// 🔐 СИСТЕМА АВТОРИЗАЦИИ
async function login() {
    const loginInput = document.getElementById('login');
    const passwordInput = document.getElementById('password');
    
    const loginValue = loginInput.value.trim();
    const passwordValue = passwordInput.value.trim();
    
    console.log('🚀 Попытка входа:', loginValue);
    
    if (!loginValue || !passwordValue) {
        showMessage('❌ Пожалуйста, заполните все поля', 'error');
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
            const errorText = await response.text();
            throw new Error(`Ошибка сервера: ${response.status}`);
        }
        
        const result = await response.json();
        console.log('✅ Успешный вход:', result.user);
        
        if (result.error) {
            throw new Error(result.error);
        }
        
        authToken = result.token;
        currentUser = result.user;
        localStorage.setItem('authToken', authToken);
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
        
        await showMainInterface();
        
    } catch (error) {
        console.error('💥 Ошибка входа:', error);
        showMessage('Ошибка входа: ' + error.message, 'error');
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
    } else {
        document.getElementById('admin-panel').classList.add('hidden');
        document.getElementById('push-admin-panel').classList.add('hidden');
    }
    
    // ✅ Инициализация Push Manager
    if (!pushManager) {
        console.log('🚀 Создание Push Manager...');
        pushManager = new PushManager();
    } else {
        console.log('📱 Push Manager уже создан');
    }
    
    // Инициализация Search и уведомлений
    initializeSearch();
    await loadNotifications();
    
    console.log('✅ Главный интерфейс показан');
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
        const response = await fetch(url, {
            ...options,
            headers
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ошибка: ${response.status}`);
        }
        
        return await response.json();
        
    } catch (error) {
        console.error('❌ Ошибка API:', error);
        throw new Error('Не удалось подключиться к серверу');
    }
}

async function loadNotifications() {
    try {
        console.log('📥 Загрузка уведомлений...');
        
        const data = await apiRequest('/api/notifications');
        console.log('✅ Уведомления загружены:', data.length);
        
        allNotifications = data;
        
        applyFilters();
        
    } catch (error) {
        console.error('❌ Ошибка загрузки уведомлений:', error);
        showMessage('Ошибка загрузки уведомлений: ' + error.message, 'error');
        
        // Показываем пустое состояние
        const container = document.getElementById('notifications-container');
        container.innerHTML = `
            <div class="card empty-state">
                <div class="icon">⚠️</div>
                <h3>Ошибка загрузки</h3>
                <p>${error.message}</p>
                <button onclick="loadNotifications()" class="btn btn-primary">
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
                <h3>Уведомлений не найдено</h3>
                <p>Попробуйте изменить параметры поиска</p>
                <button onclick="clearFilters()" class="btn btn-primary">
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
            highlightedTitle = notification.title.replace(regex, '<mark>$1</mark>');
            highlightedContent = notification.content.replace(regex, '<mark>$1</mark>');
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
                    <span class="meta-item">📅 ${formatDate(notification.created_at)}</span>
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
    const title = document.getElementById('notification-title').value.trim();
    const content = document.getElementById('notification-content').value.trim();
    const is_important = document.getElementById('notification-important').checked;
    const category = document.getElementById('notification-category').value;
    const priority = document.getElementById('notification-priority').value;
    const tagsInput = document.getElementById('notification-tags').value.trim();
    
    if (!title || !content) {
        showMessage('❌ Заголовок и содержание обязательны', 'error');
        return;
    }
    
    try {
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
                tags
            })
        });
        
        if (!response.ok) {
            throw new Error(`Ошибка сервера: ${response.status}`);
        }
        
        const result = await response.json();
        
        // Очистка формы
        document.getElementById('notification-title').value = '';
        document.getElementById('notification-content').value = '';
        document.getElementById('notification-important').checked = false;
        document.getElementById('notification-category').value = 'общее';
        document.getElementById('notification-priority').value = 'medium';
        document.getElementById('notification-tags').value = '';
        
        showMessage('✅ Уведомление успешно создано!', 'success');
        
        // Перезагрузка уведомлений
        await loadNotifications();
        
    } catch (error) {
        console.error('💥 Ошибка создания уведомления:', error);
        showMessage('❌ Ошибка создания уведомления: ' + error.message, 'error');
    }
}

async function deleteNotification(id) {
    if (!confirm('Удалить это уведомление?')) return;
    
    try {
        await apiRequest(`/api/notifications/${id}`, {
            method: 'DELETE'
        });
        
        showMessage('✅ Уведомление удалено!', 'success');
        await loadNotifications();
        
    } catch (error) {
        showMessage('❌ Ошибка удаления: ' + error.message, 'error');
    }
}

// 🔍 СИСТЕМА ПОИСКА И ФИЛЬТРАЦИИ
function initializeSearch() {
    console.log('🔍 Инициализация поиска и фильтров');
    
    // Поиск по вводу
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', function(e) {
            pendingFilters.searchText = e.target.value.toLowerCase();
            updatePreviewStats();
        });
    }
    
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
    
    updateFilterIndicators();
}

function applyFilters() {
    console.log('🎯 Применение фильтров:', pendingFilters);
    
    currentFilters = {...pendingFilters};
    
    if (allNotifications.length === 0) {
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
}

function updateFilterIndicators() {
    const filterElements = [
        'filter-category', 'filter-priority', 'filter-importance', 
        'filter-author', 'filter-date-from', 'filter-date-to'
    ];
    
    filterElements.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            const filterName = id.replace('filter-', '');
            if (pendingFilters[filterName] !== 'all' && pendingFilters[filterName] !== '') {
                element.classList.add('filter-active');
            } else {
                element.classList.remove('filter-active');
            }
        }
    });
    
    updatePreviewStats();
}

function updatePreviewStats() {
    if (allNotifications.length === 0) return;
    
    const previewCount = calculatePreviewCount();
    const statsElement = document.getElementById('search-stats');
    
    if (statsElement) {
        if (JSON.stringify(pendingFilters) === JSON.stringify(currentFilters)) {
            statsElement.innerHTML = `Показано <strong>${previewCount}</strong> из ${allNotifications.length} уведомлений`;
        } else {
            statsElement.innerHTML = `
                <div style="color: #e67e22;">⚡ Фильтры не применены</div>
                <div>Будет показано: <strong>${previewCount}</strong> из ${allNotifications.length}</div>
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

function updateSearchStats(shown, total) {
    const statsElement = document.getElementById('search-stats');
    
    if (statsElement) {
        if (shown === 0 && total > 0) {
            statsElement.innerHTML = `
                <div style="color: #e74c3c;">🔍 Уведомления не найдены</div>
                <div>Попробуйте изменить параметры поиска</div>
            `;
        } else if (shown === total) {
            statsElement.innerHTML = `Все уведомления: <strong>${total}</strong>`;
        } else {
            statsElement.innerHTML = `Показано <strong>${shown}</strong> из ${total} уведомлений`;
        }
    }
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
        updateSearchStats(allNotifications.length, allNotifications.length);
    } else {
        updateSearchStats(0, 0);
    }
    
    updateFilterIndicators();
    showMessage('🗑️ Все фильтры очищены!', 'success');
}

function searchByTag(tag) {
    console.log(`🔍 Поиск по тегу: ${tag}`);
    
    document.getElementById('search-input').value = tag;
    pendingFilters.searchText = tag.toLowerCase();
    applyFilters();
}

// 📧 PUSH УВЕДОМЛЕНИЯ - UI Функции
// 🔧 Улучшенная функция переключения Push
async function togglePushNotifications() {
    // ✅ Проверяем что pushManager существует
    if (!pushManager) {
        console.error('❌ pushManager не инициализирован');
        showMessage('❌ Система уведомлений не инициализирована. Перезагрузите страницу.', 'error');
        return;
    }
    
    const btn = document.getElementById('push-toggle-btn');
    
    if (!pushManager.isSupported) {
        showMessage('❌ Ваш браузер не поддерживает Push-уведомления', 'error');
        return;
    }

    // Проверяем инициализацию
    if (!pushManager.initialized) {
        showMessage('🔄 Система уведомлений еще не готова. Подождите немного...', 'error');
        return;
    }

    try {
        btn.disabled = true;
        btn.textContent = '⏳ Обработка...';
        
        if (pushManager.isSubscribed) {
            await pushManager.unsubscribeFromPush();
            showMessage('🔕 Push-уведомления отключены', 'success');
        } else {
            await pushManager.subscribeToPush();
            showMessage('🔔 Push-уведомления включены!', 'success');
        }
        
    } catch (error) {
        console.error('❌ Ошибка переключения Push:', error);
        showMessage('❌ Ошибка: ' + error.message, 'error');
    } finally {
        btn.disabled = false;
        // Обновляем текст кнопки
        updatePushButtonText();
    }
}

// 🔧 Функция обновления текста кнопки
function updatePushButtonText() {
    const btn = document.getElementById('push-toggle-btn');
    if (!btn || !pushManager) return;
    
    if (pushManager.isSubscribed) {
        btn.textContent = 'Отключить уведомления';
        btn.className = 'btn btn-danger';
    } else {
        btn.textContent = 'Включить уведомления';
        btn.className = 'btn btn-primary';
    }
}

async function testPushNotification() {
    if (currentUser.role !== 'admin') {
        showMessage('❌ Только администраторы могут отправлять тестовые уведомления', 'error');
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
                title: 'Тестовое уведомление 🔔',
                message: 'Это тестовое Push-уведомление от StudentNotify!'
            })
        });

        const result = await response.json();
        
        if (response.ok) {
            showMessage(`✅ Тестовый Push отправлен (${result.sentCount} пользователей)`, 'success');
        } else {
            throw new Error(result.error || 'Ошибка отправки');
        }
    } catch (error) {
        console.error('❌ Ошибка отправки тестового Push:', error);
        showMessage('❌ Ошибка отправки теста: ' + error.message, 'error');
    }
}

async function sendCustomPush() {
    if (currentUser.role !== 'admin') {
        showMessage('❌ Только администраторы могут отправлять Push-уведомления', 'error');
        return;
    }

    const titleInput = document.getElementById('push-title');
    const messageInput = document.getElementById('push-message');
    
    const title = titleInput ? titleInput.value.trim() : '';
    const message = messageInput ? messageInput.value.trim() : '';

    if (!title || !message) {
        showMessage('❌ Заполните заголовок и сообщение', 'error');
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
                title: title,
                message: message
            })
        });

        const result = await response.json();

        if (response.ok) {
            showMessage(`✅ Push отправлен (${result.sentCount} пользователям)`, 'success');
            
            // Очистка формы
            if (titleInput) titleInput.value = '';
            if (messageInput) messageInput.value = '';
            
        } else {
            throw new Error(result.error || 'Ошибка отправки');
        }

    } catch (error) {
        console.error('❌ Ошибка отправки кастомного Push:', error);
        showMessage('❌ Ошибка отправки: ' + error.message, 'error');
    }
}

// 🚀 ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
function showMessage(message, type = 'success') {
    // Удаляем существующие сообщения
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
        transform: translateX(400px);
        opacity: 0;
        transition: all 0.5s ease;
        max-width: 400px;
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

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleString('ru-RU');
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
window.sendCustomPush = sendCustomPush;
