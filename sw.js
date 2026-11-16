// Минимальный service worker: нужен браузеру, чтобы предложить «Установить приложение».
// Ничего не кэширует, поэтому обновления игры приходят сразу.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
