// Service Worker для Push-уведомлений
console.log('🔧 Service Worker загружен');

self.addEventListener('install', (event) => {
    console.log('✅ Service Worker установлен');
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    console.log('✅ Service Worker активирован');
    event.waitUntil(self.clients.claim());
});

// Обработка Push-уведомлений
self.addEventListener('push', (event) => {
    console.log('📨 Получено Push-уведомление', event);
    
    if (!event.data) {
        console.log('❌ Push event не содержит данных');
        return;
    }

    try {
        let data = {};
        try {
            data = event.data.json();
            console.log('📊 Данные уведомления:', data);
        } catch (e) {
            // Если данные не в JSON формате, используем текстовые
            data = {
                title: 'Новое уведомление',
                body: event.data.text() || 'У вас новое сообщение'
            };
        }

        const options = {
            body: data.body || 'Новое уведомление от StudentNotify',
            icon: data.icon || '/icons/icon-192.png',
            badge: data.badge || '/icons/badge-72.png',
            tag: data.tag || 'student-notification',
            vibrate: [200, 100, 200],
            data: data.data || {},
            actions: data.actions || [
                {
                    action: 'open',
                    title: 'Открыть',
                    icon: '/icons/check-72.png'
                },
                {
                    action: 'close',
                    title: 'Закрыть',
                    icon: '/icons/x-72.png'
                }
            ]
        };

        console.log('🎯 Показываем уведомление:', data.title, options);

        event.waitUntil(
            self.registration.showNotification(data.title, options)
        );

    } catch (error) {
        console.error('❌ Ошибка обработки Push:', error);
        
        // Fallback уведомление
        const fallbackOptions = {
            body: 'Новое уведомление от StudentNotify',
            icon: '/icons/icon-192.png',
            badge: '/icons/badge-72.png'
        };
        
        event.waitUntil(
            self.registration.showNotification('StudentNotify', fallbackOptions)
        );
    }
});

// Обработка кликов по уведомлениям
self.addEventListener('notificationclick', (event) => {
    console.log('🖱 Клик по уведомлению:', event);
    
    event.notification.close();

    const action = event.action;
    const notificationData = event.notification.data || {};

    if (action === 'open' || action === '') {
        // Клик по уведомлению или кнопке "Открыть"
        event.waitUntil(
            clients.matchAll({ 
                type: 'window',
                includeUncontrolled: true
            }).then((clientList) => {
                // Ищем открытую вкладку с нашим приложением
                for (const client of clientList) {
                    if (client.url.includes(self.registration.scope) && 'focus' in client) {
                        console.log('✅ Найдена открытая вкладка, фокусируемся');
                        client.focus();
                        return;
                    }
                }
                
                // Если вкладка не найдена, открываем новую
                if (clients.openWindow) {
                    console.log('🌐 Открываем новую вкладку');
                    return clients.openWindow(notificationData.url || '/');
                }
            })
        );
    } else if (action === 'close') {
        // Кнопка "Закрыть" - просто закрываем уведомление
        console.log('❌ Уведомление закрыто пользователем');
    }
});

// Сообщения от главного потока
self.addEventListener('message', (event) => {
    console.log('📨 Сообщение от главного потока:', event.data);
    
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});