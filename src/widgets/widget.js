/**
 * Amazon Modern Widgets - browser widget.
 *
 * Turns every <div class="amw" id="ASIN"></div> of the host page into a product card
 * (image, title, price, affiliate link), including elements added after page load.
 * The display language follows the page's <html lang> attribute (default: fr).
 *
 * Runs on third-party pages: everything coming from the API is treated as untrusted
 * and inserted with textContent, sanitizeText() or safeUrl().
 */

(function() {
    'use strict';

    // Only available while the script first runs, hence captured here
    const currentScript = document.currentScript;

    // Published next to widget.js by scripts/build-widgets.js
    const WIDGET_CSS_FILE = 'widget.css';

    /**
     * Turns a configured API base URL (absolute, or relative to the page) into an absolute
     * http(s) URL without trailing slash; anything else yields null.
     */
    function resolveApiBaseUrl(value) {
        if (typeof value !== 'string' || value.trim() === '') {
            return null;
        }
        try {
            const url = new URL(value.trim(), document.baseURI);
            if (url.protocol !== 'https:' && url.protocol !== 'http:') {
                return null;
            }
            return url.href.replace(/\/+$/, '');
        } catch (e) {
            return null;
        }
    }

    const WIDGET_CONFIG = {

        // By default the API is expected on the host page's origin (reverse proxy to the AMW
        // server under /item). <script data-api-base-url="https://amw.example.com/amw"> points
        // the widget to another server, which must then allow the page's origin (Server.cors).
        apiBaseUrl: resolveApiBaseUrl(currentScript && currentScript.getAttribute('data-api-base-url')) ||
            window.location.origin + '/item',
        
        performance: {
            // Product requests running at once; the others wait in a queue
            maxConcurrentRequests: 5,
            cacheExpiry: 300000 // 5 minutes
        },
        
        // Lazy loading configuration
        lazyLoading: {
            enabled: true,
            rootMargin: '50px', // Start loading when element is 50px from viewport
            threshold: 0.1 // Trigger when 10% of element is visible
        },

        api: {
            timeout: 10000, // 10 seconds
            retryAttempts: 2,
            retryDelay: 1000 // 1 second
        },
        
        // Supported languages
        languages: {
            fr: {
                buy: '➕ Plus d\'infos',
                update: '↻ Dernière mise à jour : ',
                not_available: "Non disponible",
                loading: "Chargement...",
                error_not_found: "Produit non trouvé",
                error_network: "Erreur de connexion",
                error_timeout: "Délai dépassé",
                error_retry_message: "Vérifiez votre connexion ou réessayez plus tard",
                savings: 'de réduction',
                sponsored: 'lien sponsorisé',
                new_tab: 's\'ouvre dans un nouvel onglet'
            },
            es: {
                buy: '🚀 Yo voy !',
                update: '↻ Ultima actualización : ',
                not_available: "No disponible",
                loading: "Cargando...",
                error_not_found: "Producto no encontrado",
                error_network: "Error de conexión",
                error_timeout: "Tiempo agotado",
                error_retry_message: "Verifique su conexión o inténtelo de nuevo más tarde",
                savings: 'de descuento',
                sponsored: 'enlace patrocinado',
                new_tab: 'se abre en una nueva pestaña'
            },
            en: {
                buy: '🚀 Let\'s go !',
                update: '↻ Last product update : ',
                not_available: "Not available",
                loading: "Loading...",
                error_not_found: "Product not found",
                error_network: "Connection error",
                error_timeout: "Request timeout",
                error_retry_message: "Check your connection or try again later",
                savings: 'off',
                sponsored: 'sponsored link',
                new_tab: 'opens in a new tab'
            },
            de: {
                buy: '🚀 Los geht\'s!',
                update: '↻ Letzte Aktualisierung : ',
                not_available: "Nicht verfügbar",
                loading: "Wird geladen...",
                error_not_found: "Produkt nicht gefunden",
                error_network: "Verbindungsfehler",
                error_timeout: "Zeitüberschreitung",
                error_retry_message: "Überprüfen Sie Ihre Verbindung oder versuchen Sie es später erneut",
                savings: 'Rabatt',
                sponsored: 'gesponserter Link',
                new_tab: 'öffnet in einem neuen Tab'
            },
            it: {
                buy: '🚀 Andiamo!',
                update: '↻ Ultimo aggiornamento : ',
                not_available: "Non disponibile",
                loading: "Caricamento...",
                error_not_found: "Prodotto non trovato",
                error_network: "Errore di connessione",
                error_timeout: "Timeout della richiesta",
                error_retry_message: "Controlla la tua connessione o riprova più tardi",
                savings: 'di sconto',
                sponsored: 'link sponsorizzato',
                new_tab: 'si apre in una nuova scheda'
            },
            pt: {
                buy: '🚀 Vamos lá!',
                update: '↻ Última atualização : ',
                not_available: "Indisponível",
                loading: "Carregando...",
                error_not_found: "Produto não encontrado",
                error_network: "Erro de conexão",
                error_timeout: "Tempo limite esgotado",
                error_retry_message: "Verifique sua conexão ou tente novamente mais tarde",
                savings: 'de desconto',
                sponsored: 'link patrocinado',
                new_tab: 'abre em uma nova aba'
            },
            nl: {
                buy: '🚀 Laten we gaan!',
                update: '↻ Laatste update : ',
                not_available: "Niet beschikbaar",
                loading: "Laden...",
                error_not_found: "Product niet gevonden",
                error_network: "Verbindingsfout",
                error_timeout: "Verzoek time-out",
                error_retry_message: "Controleer uw verbinding of probeer het later opnieuw",
                savings: 'korting',
                sponsored: 'gesponsorde link',
                new_tab: 'opent in een nieuw tabblad'
            }
        }
    };


    /**
     * URL of the stylesheet published next to this script (<path>/widget.css). When the script
     * URL is unknown (document.currentScript is null for scripts run by eval), the widget's server
     * is reached through the API base URL, which serves the same files.
     */
    function getStylesheetUrl() {
        try {
            if (currentScript && currentScript.src) {
                return new URL(WIDGET_CSS_FILE, currentScript.src).href;
            }
        } catch (e) {
            // Falls through to the API base URL
        }
        return `${WIDGET_CONFIG.apiBaseUrl}/${WIDGET_CSS_FILE}`;
    }

    /**
     * Loads the widget stylesheet once. It is a separate file so that browsers cache it apart
     * from the script; if it fails to load, widgets stay usable links, only unstyled.
     */
    function injectCSS() {
        if (document.getElementById('amw-widget-styles')) {
            return;
        }

        const link = document.createElement('link');
        link.id = 'amw-widget-styles';
        link.rel = 'stylesheet';
        link.href = getStylesheetUrl();
        document.head.appendChild(link);
    }

    /**
     * Generates lazy loading placeholder HTML
     */
    function generateLazyPlaceholderHTML(language) {
        const lang = WIDGET_CONFIG.languages[language] || WIDGET_CONFIG.languages.fr;
        
        return `
            <div class="amw-widget-lazy-placeholder">
                <div class="amw-widget-lazy-icon" aria-hidden="true"></div>
                <span>${lang.loading}</span>
            </div>
        `;
    }

    /**
     * Generates error placeholder HTML
     */
    function generateErrorPlaceholderHTML(productId, language, errorType = 'not_found') {
        productId = sanitizeText(productId);
        const lang = WIDGET_CONFIG.languages[language] || WIDGET_CONFIG.languages.fr;
        
        let errorMessage;
        switch(errorType) {
            case 'not_found':
                errorMessage = `${lang.error_not_found}: ${productId}`;
                break;
            case 'network_error':
                errorMessage = lang.error_network;
                break;
            case 'timeout':
                errorMessage = lang.error_timeout;
                break;
            default:
                errorMessage = `${lang.error_not_found}: ${productId}`;
        }
        
        return `
            <div class="amw-widget-error">
            <span class="amw-widget-error-icon" aria-hidden="true">⚠️</span>
            <div>${errorMessage}</div>
            <div class="amw-widget-error-retry-message">
                ${lang.error_retry_message}
            </div>
            </div>
        `;
    }

    /**
     * Returns the URL only if it uses http(s), so javascript: or data: URLs from a
     * poisoned API response or cache cannot run in the host page.
     */
    function safeUrl(url, fallback) {
        try {
            const parsed = new URL(url);
            return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : fallback;
        } catch (e) {
            return fallback;
        }
    }

    /**
     * HTML-escapes a string for template literals assigned to innerHTML.
     * Prefer textContent when possible; non-string input yields an empty string.
     */
    function sanitizeText(text) {
        if (typeof text !== 'string') return '';
        return text
            .replace(/[<>&"']/g, function(match) {
                const map = {
                    '<': '&lt;',
                    '>': '&gt;',
                    '&': '&amp;',
                    '"': '&quot;',
                    "'": '&#x27;'
                };
                return map[match];
            })
            .slice(0, 1000); // Bounds the size of injected markup
    }

    /**
     * Reports a click on the affiliate link. sendBeacon is queued by the browser
     * and survives the page unload, so navigation is never delayed; failures are
     * ignored because statistics must never break the widget.
     */
    function sendClickBeacon(productId) {
        if (!/^[A-Z0-9]{10}$/.test(productId) || !navigator.sendBeacon) {
            return;
        }
        try {
            navigator.sendBeacon(`${WIDGET_CONFIG.apiBaseUrl}/click?id=${encodeURIComponent(productId)}`);
        } catch (e) {
            // Ignored on purpose, see above
        }
    }

    // Makes the ids referenced by aria-describedby unique across the widgets of a page
    let widgetCount = 0;

    /**
     * Generates widget HTML
     */
    function generateWidgetHTML(productId, language) {
        const lang = WIDGET_CONFIG.languages[language] || WIDGET_CONFIG.languages.fr;
        const idPrefix = `amw-widget-${++widgetCount}`;

        // No src until the product is known: an empty src makes some browsers request the page.
        // width/height give a square aspect ratio until the image is decoded, so the card does
        // not grow when it arrives (the CSS still sizes it to its column), and lazy/async
        // loading keeps off-screen images from competing with the host page.
        // The whole card is one link. Its name, computed from its content, is only the title,
        // the price and the sponsored/new tab notice: the image is decorative, the buy label
        // and the banner repeat the link, and the update date is exposed as its description.
        return `
            <a href="#" class="amw-widget-main-link" target="_blank" rel="sponsored nofollow"
               aria-describedby="${idPrefix}-update">
                <div class="amw-widget-img-container">
                    <img alt="" class="amw-widget-img" loading="lazy" decoding="async" width="160" height="160"/>
                </div>

                <div class="amw-widget-content">
                    <div class="amw-widget-body">
                        <div class="amw-widget-title">
                            <span class="amw-widget-caption"></span>
                        </div>

                        <div class="amw-widget-buttons">
                            <span class="amw-widget-btn amw-widget-btn-success amw-widget-price"></span>
                            <span class="amw-widget-btn amw-widget-btn-warning" aria-hidden="true">${lang.buy}</span>
                        </div>

                        <p class="amw-widget-text">
                            <span class="amw-widget-timestamp" id="${idPrefix}-update" aria-hidden="true"></span>
                        </p>
                        <span class="amw-widget-visually-hidden">(${lang.sponsored}, ${lang.new_tab})</span>
                    </div>

                    <div class="amw-widget-banner" aria-hidden="true">
                       #Amazon
                    </div>
                </div>
            </a>

            <div class="amw-widget-spinner">
                <div class="amw-widget-spinner-grow" role="status">
                    <span class="amw-widget-visually-hidden">${lang.loading}</span>
                </div>
            </div>
        `;
    }

    /**
     * Fetches a product, retrying on network errors and timeouts.
     * Resolves with the product (null when the API returns null), rejects once the retries are exhausted.
     */
    function requestProduct(productId, attempt) {
        const url = `${WIDGET_CONFIG.apiBaseUrl}/product?id=${encodeURIComponent(productId)}`;

        // The timeout starts when the request leaves the queue, not while it waits for a slot
        return runLimited(() => new Promise((resolve, reject) => {
            // Aborting frees the connection of a timed-out request before the retry starts
            const controller = typeof AbortController === 'function' ? new AbortController() : null;
            const fetchTimeout = setTimeout(() => {
                const error = new Error(`Timeout after ${WIDGET_CONFIG.api.timeout} ms`);
                error.name = 'TimeoutError';
                reject(error);
                if (controller) {
                    controller.abort();
                }
            }, WIDGET_CONFIG.api.timeout);

            fetch(url, controller ? { signal: controller.signal } : undefined)
                .then(response => {
                    // 404 means Amazon has no such item: a final answer, unlike 5xx and network errors
                    if (response.status === 404) {
                        return null;
                    }
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}`);
                    }
                    return response.json();
                })
                .then(resolve, reject)
                .finally(() => clearTimeout(fetchTimeout));
        })).catch(error => {
            console.error(`Error loading product ${productId} (attempt ${attempt}):`, error);
            if (attempt >= WIDGET_CONFIG.api.retryAttempts) {
                throw error;
            }
            return new Promise(resolve => setTimeout(resolve, WIDGET_CONFIG.api.retryDelay))
                .then(() => requestProduct(productId, attempt + 1));
        });
    }

    /**
     * Runs `task` (a function returning a promise) once fewer than maxConcurrentRequests tasks
     * are running, so a page full of widgets does not burst the API and its per-IP rate limit.
     */
    function runLimited(task) {
        return new Promise((resolve, reject) => {
            requestQueue.push(() => {
                runningRequests++;
                let result;
                try {
                    result = Promise.resolve(task());
                } catch (error) {
                    result = Promise.reject(error);
                }
                result.then(resolve, reject).finally(() => {
                    runningRequests--;
                    runQueuedRequests();
                });
            });
            runQueuedRequests();
        });
    }

    function runQueuedRequests() {
        // At least one slot, so a 0 or invalid setting cannot stall every widget
        const limit = Math.max(1, Number(WIDGET_CONFIG.performance.maxConcurrentRequests) || 1);
        while (runningRequests < limit && requestQueue.length > 0) {
            requestQueue.shift()();
        }
    }

    // Amazon's Associates terms forbid showing prices older than 24 hours, whatever cacheExpiry says
    const MAX_CACHE_EXPIRY = 24 * 60 * 60 * 1000;

    function getCacheExpiry() {
        return Math.min(Number(WIDGET_CONFIG.performance.cacheExpiry) || 0, MAX_CACHE_EXPIRY);
    }

    function getCachedProduct(cacheKey) {
        const cached = productCache.get(cacheKey);
        return cached && (Date.now() - cached.timestamp < getCacheExpiry()) ? cached.data : null;
    }

    /**
     * Returns the pending request for a product, or starts one. Sharing the pending promise
     * lets every widget showing the same product be filled by a single API call.
     */
    function fetchProduct(productId, cacheKey) {
        const pending = activeRequests.get(cacheKey);
        if (pending) {
            return pending;
        }

        const request = requestProduct(productId, 1).then(product => {
            activeRequests.delete(cacheKey);
            if (product !== null) {
                productCache.set(cacheKey, {
                    data: product,
                    timestamp: Date.now()
                });
                persistProductCache();
            }
            return product;
        }, error => {
            activeRequests.delete(cacheKey);
            throw error;
        });

        activeRequests.set(cacheKey, request);
        return request;
    }

    /**
     * Fills a widget with its product, or with an error placeholder.
     */
    function loadProductData(productId, widgetElement, language) {
        const cacheKey = `${productId}_${language}`;
        // A cached product is rendered synchronously, without a spinner frame
        const cached = getCachedProduct(cacheKey);
        if (cached) {
            updateWidgetWithData(cached, widgetElement, language);
            return;
        }

        // A live region only for the errors: announcing every filled card would make all the
        // widgets of the page talk at once. aria-busy holds announcements during the load.
        widgetElement.setAttribute('aria-live', 'polite');
        widgetElement.setAttribute('aria-busy', 'true');

        fetchProduct(productId, cacheKey).then(product => {
            if (product === null) {
                showError(widgetElement, productId, language, 'not_found');
                console.log(`Amazon product not found: ${productId}`);
                return;
            }
            widgetElement.removeAttribute('aria-live');
            updateWidgetWithData(product, widgetElement, language);
        }, error => {
            showError(widgetElement, productId, language, error && error.name === 'TimeoutError' ? 'timeout' : 'network_error');
        });
    }

    function showError(widgetElement, productId, language, errorType) {
        widgetElement.innerHTML = generateErrorPlaceholderHTML(productId, language, errorType);
        widgetElement.setAttribute('aria-busy', 'false');
    }

    /**
     * Injects schema.org Product JSON-LD so search engines can show rich results for the host page
     */
    function injectJsonLd(product) {
        var name = product.title || '';
        if (name.length > 150) {
            name = name.substring(0, 147) + '...';
        }

        const jsonLd = {
            '@context': 'https://schema.org',
            '@type': 'Product',
            'name': name,
            'image': product.image || '',
            'description': product.title || '',
            'offers': {
                '@type': 'Offer',
                'priceCurrency': product.currency || 'EUR',
                'price': product.price !== -1 ? (function(p) {
                    var s = String(p).replace(/[^0-9.,]/g, '');
                    s = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
                    var n = parseFloat(s);
                    return isNaN(n) ? 0 : n;
                })(product.price) : 0,
                'availability': product.price !== -1 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
                'url': product.url || ''
            }
        };

        if (product.brand) {
            jsonLd['brand'] = {
                '@type': 'Brand',
                'name': product.brand
            };
        }

        if (product.asin) {
            jsonLd['sku'] = product.asin;
        }

        const script = document.createElement('script');
        script.type = 'application/ld+json';
        script.textContent = JSON.stringify(jsonLd);
        document.head.appendChild(script);
    }

    /**
     * Runs work that the visitor does not see once the browser is idle. The timeout bounds
     * the wait on busy pages, since crawlers only render a page for a limited time.
     */
    function runWhenIdle(callback) {
        if (typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(callback, { timeout: 2000 });
        } else {
            setTimeout(callback, 1);
        }
    }

    /**
     * Updates widget elements with product data
     */
    function updateWidgetWithData(product, widgetElement, language) {
        const lang = WIDGET_CONFIG.languages[language] || WIDGET_CONFIG.languages.fr;
        
        const img = widgetElement.querySelector('.amw-widget-img');
        const caption = widgetElement.querySelector('.amw-widget-caption');
        const price = widgetElement.querySelector('.amw-widget-price');
        const timestamp = widgetElement.querySelector('.amw-widget-timestamp');
        const links = widgetElement.querySelectorAll('.amw-widget-link');
        const spinner = widgetElement.querySelector('.amw-widget-spinner');
        const content = widgetElement.querySelector('.amw-widget-content');
        const body = widgetElement.querySelector('.amw-widget-body');

        img.src = safeUrl(product.image, '');
        img.onerror = function() { this.style.display = 'none'; };
        
        // Truncated to keep cards the same height
        const productTitle = product.title || 'Produit Amazon';
        caption.textContent = productTitle.length > 70 ? productTitle.slice(0, 67) + '...' : productTitle;
        
        const mainLink = widgetElement.querySelector('.amw-widget-main-link');
        if (mainLink) {
            mainLink.href = safeUrl(product.url, '#');
            const productId = widgetElement.getAttribute('data-product-id') || widgetElement.id;
            mainLink.addEventListener('click', function() { sendClickBeacon(productId); });
            // auxclick covers the middle click that opens the link in a new tab
            mainLink.addEventListener('auxclick', function(event) {
                if (event.button === 1) sendClickBeacon(productId);
            });
        }
        
        timestamp.textContent = lang.update + new Date(product.timestamp).toLocaleString();

        if (product.price === -1) {
            price.textContent = lang.not_available;
        } else {
            price.textContent = product.price;
        }

        // innerHTML is safe here: price is escaped and savings coerced to a number
        const savings = Number(product.savings);
        if (savings > 0) {
            price.innerHTML = sanitizeText(product.price) + ` <span class="amw-widget-badge">-${savings}%<span class="amw-widget-visually-hidden"> ${lang.savings}</span></span>`;
        }

        // Only crawlers read the JSON-LD, so it must not delay showing the card
        runWhenIdle(function() { injectJsonLd(product); });

        spinner.style.display = 'none';
        img.style.display = 'block';
        content.style.display = 'block';
        body.style.display = 'block';
        widgetElement.setAttribute('aria-busy', 'false');
    }

    // Bumped whenever the stored format or the product format changes, so old entries are ignored
    const STORAGE_KEY = 'amw:products:v1';
    // Bounds the space taken in the host site's sessionStorage (about 1 KB per product)
    const MAX_STORED_PRODUCTS = 50;

    /**
     * Returns sessionStorage, or null when the browser blocks it (privacy settings, sandboxed
     * iframes): merely reading window.sessionStorage can throw there.
     */
    function getSessionStorage() {
        try {
            return window.sessionStorage || null;
        } catch (e) {
            return null;
        }
    }

    /**
     * Loads the products stored by previous page views of the session, so navigating within
     * the site reuses them instead of calling the API again. Expired or malformed entries are dropped.
     */
    function restoreProductCache() {
        const storage = getSessionStorage();
        if (!storage) {
            return;
        }
        try {
            const stored = JSON.parse(storage.getItem(STORAGE_KEY) || '{}');
            Object.keys(stored).forEach(cacheKey => {
                const entry = stored[cacheKey];
                if (entry && typeof entry.timestamp === 'number' && entry.data && typeof entry.data === 'object' &&
                    Date.now() - entry.timestamp < getCacheExpiry()) {
                    productCache.set(cacheKey, { data: entry.data, timestamp: entry.timestamp });
                }
            });
        } catch (e) {
            console.warn('AMW: stored product cache ignored', e);
        }
    }

    /**
     * Stores the most recent products; a full or blocked storage only costs the persistence.
     */
    function persistProductCache() {
        const storage = getSessionStorage();
        if (!storage) {
            return;
        }
        const now = Date.now();
        const entries = Array.from(productCache.entries())
            .filter(([, entry]) => now - entry.timestamp < getCacheExpiry())
            .sort((a, b) => b[1].timestamp - a[1].timestamp)
            .slice(0, MAX_STORED_PRODUCTS);
        try {
            storage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
        } catch (e) {
            console.warn('AMW: product cache not persisted', e);
        }
    }

    /**
     * Client-side cache for product data, persisted in sessionStorage
     */
    const productCache = new Map();
    // Pending product promises by cache key, shared by widgets showing the same product
    const activeRequests = new Map();
    // Product requests waiting for a slot (see runLimited)
    const requestQueue = [];
    let runningRequests = 0;

    restoreProductCache();

    /**
     * Intersection Observer for lazy loading
     */
    let lazyLoadObserver = null;

    /**
     * Creates and configures the lazy loading observer
     */
    function createLazyLoadObserver() {
        if (!window.IntersectionObserver) {
            console.warn('IntersectionObserver not supported, falling back to immediate loading');
            return null;
        }

        const options = {
            root: null,
            rootMargin: WIDGET_CONFIG.lazyLoading.rootMargin,
            threshold: WIDGET_CONFIG.lazyLoading.threshold
        };

        return new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const element = entry.target;
                    const productId = element.getAttribute('data-product-id');
                    const language = element.getAttribute('data-language');
                    
                    loadActualWidget(element, productId, language);
                    
                    lazyLoadObserver.unobserve(element);
                }
            });
        }, options);
    }

    /**
     * Loads the actual widget content (called when widget becomes visible)
     */
    function loadActualWidget(element, productId, language) {
        element.innerHTML = generateWidgetHTML(productId, language);
        element.className = 'amw-widget';
        
        loadProductData(productId, element, language);
    }

    /**
     * Transforms a div element into a lazy-loaded widget
     */
    function transformToLazyWidget(element) {
        const productId = element.id;
        if (!productId) {
            console.warn('Amazon widget element missing id attribute');
            return;
        }

        const language = document.documentElement.getAttribute('lang') || 'fr';

        // Read back by the IntersectionObserver callback
        element.setAttribute('data-product-id', productId);
        element.setAttribute('data-language', language);

        element.className = 'amw-widget amw-widget-lazy';
        element.innerHTML = generateLazyPlaceholderHTML(language);

        if (lazyLoadObserver) {
            lazyLoadObserver.observe(element);
        } else {
            // Browsers without IntersectionObserver load immediately
            loadActualWidget(element, productId, language);
        }
    }

    /**
     * Transforms a div element into a widget (immediate loading)
     */
    function transformToWidget(element) {
        const productId = element.id;
        if (!productId) {
            console.warn('Amazon widget element missing id attribute');
            return;
        }

        const language = document.documentElement.getAttribute('lang') || 'fr';

        element.className = 'amw-widget';
        element.innerHTML = generateWidgetHTML(productId, language);

        loadProductData(productId, element, language);
    }

    /**
     * Initializes all widgets on the page
     */
    function initializeWidgets() {
        injectCSS();

        if (WIDGET_CONFIG.lazyLoading.enabled) {
            lazyLoadObserver = createLazyLoadObserver();
        }

        const amwElements = document.querySelectorAll('div.amw');
        
        if (WIDGET_CONFIG.lazyLoading.enabled) {
            amwElements.forEach(transformToLazyWidget);
            console.log(`Initialized ${amwElements.length} AMW widgets with lazy loading`);
        } else {
            amwElements.forEach(transformToWidget);
            console.log(`Initialized ${amwElements.length} AMW widgets with immediate loading`);
        }
    }

    /**
     * Observer to detect new widgets added dynamically
     */
    function setupMutationObserver() {
        const observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
                mutation.addedNodes.forEach(function(node) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        if (node.matches && node.matches('div.amw')) {
                            if (WIDGET_CONFIG.lazyLoading.enabled) {
                                transformToLazyWidget(node);
                            } else {
                                transformToWidget(node);
                            }
                        }
                        // Widgets can also be nested inside an inserted fragment
                        const amwElements = node.querySelectorAll && node.querySelectorAll('div.amw');
                        if (amwElements) {
                            if (WIDGET_CONFIG.lazyLoading.enabled) {
                                amwElements.forEach(transformToLazyWidget);
                            } else {
                                amwElements.forEach(transformToWidget);
                            }
                        }
                    }
                });
            });
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    /**
     * Main entry point
     */
    function init() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function() {
                initializeWidgets();
                setupMutationObserver();
            });
        } else {
            initializeWidgets();
            setupMutationObserver();
        }
    }

    // Public API
    window.AmwWidget = {
        init: init,
        transformElement: transformToWidget,
        transformLazyElement: transformToLazyWidget,
        config: WIDGET_CONFIG,
        // Methods to control lazy loading
        enableLazyLoading: function() {
            WIDGET_CONFIG.lazyLoading.enabled = true;
            if (!lazyLoadObserver) {
                lazyLoadObserver = createLazyLoadObserver();
            }
        },
        disableLazyLoading: function() {
            WIDGET_CONFIG.lazyLoading.enabled = false;
            if (lazyLoadObserver) {
                lazyLoadObserver.disconnect();
                lazyLoadObserver = null;
            }
        },
        // Force load all lazy widgets (useful for SEO or testing)
        loadAllWidgets: function() {
            const lazyWidgets = document.querySelectorAll('.amw-widget-lazy');
            lazyWidgets.forEach(element => {
                const productId = element.getAttribute('data-product-id');
                const language = element.getAttribute('data-language');
                if (productId && language) {
                    loadActualWidget(element, productId, language);
                }
            });
        },
        // Cleanup method to disconnect observers
        destroy: function() {
            if (lazyLoadObserver) {
                lazyLoadObserver.disconnect();
                lazyLoadObserver = null;
            }
        },
        // Check if lazy loading is supported
        isLazyLoadingSupported: function() {
            return !!window.IntersectionObserver;
        },
        // Configure API settings
        setApiConfig: function(config) {
            if (config.timeout !== undefined) {
                WIDGET_CONFIG.api.timeout = config.timeout;
            }
            if (config.retryAttempts !== undefined) {
                WIDGET_CONFIG.api.retryAttempts = config.retryAttempts;
            }
            if (config.retryDelay !== undefined) {
                WIDGET_CONFIG.api.retryDelay = config.retryDelay;
            }
            if (config.apiBaseUrl !== undefined) {
                const apiBaseUrl = resolveApiBaseUrl(config.apiBaseUrl);
                if (apiBaseUrl) {
                    WIDGET_CONFIG.apiBaseUrl = apiBaseUrl;
                } else {
                    console.warn('AMW: invalid apiBaseUrl ignored', config.apiBaseUrl);
                }
            }
            if (config.maxConcurrentRequests !== undefined) {
                WIDGET_CONFIG.performance.maxConcurrentRequests = config.maxConcurrentRequests;
                runQueuedRequests();
            }
        },
        // Get cache statistics for monitoring
        getCacheStats: function() {
            return {
                cacheSize: productCache.size,
                activeRequests: activeRequests.size,
                cacheHitRate: productCache.size > 0 ? (productCache.size / (productCache.size + activeRequests.size)) : 0
            };
        },
        // Clear cache for memory management
        clearCache: function() {
            productCache.clear();
            activeRequests.clear();
            const storage = getSessionStorage();
            try {
                if (storage) {
                    storage.removeItem(STORAGE_KEY);
                }
            } catch (e) {
                // An unusable storage has nothing to clear
            }
        }
    };

    // Automatic initialization
    init();

})();
