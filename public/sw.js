self.addEventListener("push", event => {
    const data = event.data ? event.data.json() : {};

    self.registration.showNotification(
        data.title || "Уведомление",
        {
            body: data.body || "",
            icon: "/icons/icon-192.png",
            badge: "/icons/badge.png"
        }
    );
});
