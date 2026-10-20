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

    const WIDGET_CONFIG = {

        // The API is expected on the host page's origin (reverse proxy to the AMW server under /item)
        apiBaseUrl: window.location.origin+"/item",
        
        performance: {
            debounceDelay: 300,
            maxConcurrentRequests: 5,
            cacheExpiry: 300000, // 5 minutes
            preloadImages: true
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
                error_retry_message: "Vérifiez votre connexion ou réessayez plus tard"
            },
            es: {
                buy: '🚀 Yo voy !',
                update: '↻ Ultima actualización : ',
                not_available: "No disponible",
                loading: "Cargando...",
                error_not_found: "Producto no encontrado",
                error_network: "Error de conexión",
                error_timeout: "Tiempo agotado",
                error_retry_message: "Verifique su conexión o inténtelo de nuevo más tarde"
            },
            en: {
                buy: '🚀 Let\'s go !',
                update: '↻ Last product update : ',
                not_available: "Not available",
                loading: "Loading...",
                error_not_found: "Product not found",
                error_network: "Connection error",
                error_timeout: "Request timeout",
                error_retry_message: "Check your connection or try again later"
            },
            de: {
                buy: '🚀 Los geht\'s!',
                update: '↻ Letzte Aktualisierung : ',
                not_available: "Nicht verfügbar",
                loading: "Wird geladen...",
                error_not_found: "Produkt nicht gefunden",
                error_network: "Verbindungsfehler",
                error_timeout: "Zeitüberschreitung",
                error_retry_message: "Überprüfen Sie Ihre Verbindung oder versuchen Sie es später erneut"
            },
            it: {
                buy: '🚀 Andiamo!',
                update: '↻ Ultimo aggiornamento : ',
                not_available: "Non disponibile",
                loading: "Caricamento...",
                error_not_found: "Prodotto non trovato",
                error_network: "Errore di connessione",
                error_timeout: "Timeout della richiesta",
                error_retry_message: "Controlla la tua connessione o riprova più tardi"
            },
            pt: {
                buy: '🚀 Vamos lá!',
                update: '↻ Última atualização : ',
                not_available: "Indisponível",
                loading: "Carregando...",
                error_not_found: "Produto não encontrado",
                error_network: "Erro de conexão",
                error_timeout: "Tempo limite esgotado",
                error_retry_message: "Verifique sua conexão ou tente novamente mais tarde"
            },
            nl: {
                buy: '🚀 Laten we gaan!',
                update: '↻ Laatste update : ',
                not_available: "Niet beschikbaar",
                loading: "Laden...",
                error_not_found: "Product niet gevonden",
                error_network: "Verbindingsfout",
                error_timeout: "Verzoek time-out",
                error_retry_message: "Controleer uw verbinding of probeer het later opnieuw"
            }
        }
    };

    // CSS for widgets
    const WIDGET_CSS = `
        .amw-widget {
            unset: all;
            max-width: 100%;
            min-height: 100px;
            background-color: #333;
            display: flex;
            border-radius: 12px;
            overflow: hidden;
            margin: 10px 0;
            box-shadow: 0 4px 20px rgba(0,0,0,0.15);
            font-family: ubuntu, sans-serif;
            border: 2px solid #8b5cf6;
            background: linear-gradient(135deg, #333 0%, #444 100%);
            position: relative;
            cursor: pointer;
            transition: transform 0.2s ease;
        }

        .amw-widget::after {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(
                90deg,
                transparent,
                rgba(255, 255, 255, 0.4),
                transparent
            );
            transition: left 0.5s ease-in-out;
            z-index: 1;
            pointer-events: none;
        }

        .amw-widget:hover::after {
            left: 100%;
        }

        .amw-widget:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 25px rgba(139, 92, 246, 0.3);
        }

        .amw-widget-main-link {
            color: #FFF;
            text-decoration: none;
            display: flex;
            width: 100%;
            height: 100%;
            position: relative;
        }

        .amw-widget-main-link:hover {
            color: #FFF;
        }

        .amw-widget a {
            color: #FFF;
            text-decoration: none;
        }

        .amw-widget a:hover {
            color: #CCC;
        }

        .amw-widget-img-container {
            overflow: hidden;
            flex: 0 0 24%;
            max-width: 24%;
            height: 100%;
            display: flex;
            align-items: stretch;
        }

        .amw-widget-img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            border-radius: 8px 0 0 8px;
            transform-origin: 0%;
            transition: transform 0.3s ease-out, filter 0.3s ease-in-out;
            display: none;
            will-change: transform;
            loading: lazy;
            background-color: #444;
        }

        .amw-widget-img:hover {
            transform: scale(1.05);
        }

        .amw-widget-content {
            flex: 1;
            display: none;
            display: flex;
            flex-direction: column;
            justify-content: flex-end;
        }

        .amw-widget-body {
            display: none;
            padding: 16px 20px;
        }

        .amw-widget-title {
            font-size: 0.8em;
            font-weight: bold;
            margin-bottom: 15px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            color: #FFF;
        }

        .amw-widget-text {
            margin-top: 10px;
            color: #FFF;
            font-size: 0.6em;
        }

        .amw-widget-btn {
            display: inline-block;
            font-weight: bold;
            margin-right: 15px;
            padding: 4px 10px;
            border: none;
            border-radius: 6px;
            text-decoration: none;
            cursor: pointer;
            font-size: 0.8em;
            transition: background-color 0.2s;
            pointer-events: none;
        }

        .amw-widget-buttons {
            display: flex;
            flex-wrap: wrap;
            gap: 5px;
        }

        .amw-widget-btn-success {
            background-color: #3e8d4d;
            color: white;
        }

        .amw-widget-btn-warning {
            background-color: #eccf00;
            color: #684a98;
        }

        .amw-widget-btn-warning:hover {
            background-color: #eccf00;
            color: #684a98;
        }
        
        .amw-widget-price {
            background: transparent !important;
            padding: 0 !important;
            display: flex !important;
            align-items: center !important;
            gap: 8px !important;
            border-radius: 0 !important;
            color: #2ecc71 !important;
            font-size: 20px !important;
            font-weight: 800 !important;
        }

        .amw-widget-badge {
            background: #e74c3c !important;
            color: #fff !important;
            font-size: 12px !important;
            font-weight: 700 !important;
            padding: 4px 8px !important;
            border-radius: 4px !important;
            margin-left: 0 !important;
            letter-spacing: 0.5px;
            animation: blinker 1s linear infinite;
        }

        .amw-widget-spinner {
            text-align: center;
            margin: 3rem;
        }

        .amw-widget-spinner-grow {
            display: inline-block;
            width: 2rem;
            height: 2rem;
            vertical-align: text-bottom;
            border: 0.25em solid transparent;
            border-right-color: transparent;
            border-radius: 50%;
            animation: spinner-grow 0.75s linear infinite;
            color: #ffc107;
        }

        .amw-widget-visually-hidden {
            position: absolute !important;
            width: 1px !important;
            height: 1px !important;
            padding: 0 !important;
            margin: -1px !important;
            overflow: hidden !important;
            clip: rect(0, 0, 0, 0) !important;
            white-space: nowrap !important;
            border: 0 !important;
        }

        .amw-widget-lazy {
            background: linear-gradient(90deg, #333 25%, #444 50%, #333 75%);
            background-size: 200% 100%;
            animation: shimmer 2s infinite;
            min-height: 120px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #888;
            font-size: 0.9em;
            will-change: background-position;
        }

        .amw-widget-lazy-placeholder {
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .amw-widget-lazy-icon {
            width: 20px;
            height: 20px;
            border: 2px solid #666;
            border-top: 2px solid #fff;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            will-change: transform;
        }

        .amw-widget-error {
            background-color: #2c1810;
            border: 1px solid #d32f2f;
            color: #ff6b6b;
            padding: 20px;
            text-align: center;
            border-radius: 8px;
            font-size: 0.9em;
        }

        .amw-widget-error-icon {
            font-size: 1.5em;
            margin-bottom: 10px;
            display: block;
        }

        .amw-widget-timestamp{
            margin-top: 10px;
            display: block;     
            font-size: 0.7em;
            color: #bbb;
        }
            
        .amw-widget-banner {
            position: absolute;
            bottom: 0;
            right: 0;
            background: #222;
            color: #fff;
            font-weight: bold;
            padding: 2px 40px;
            transform: rotate(-45deg) translate(50%, -130%);
            transform-origin: bottom right;
            pointer-events: none;
            box-shadow: 0 4px 10px rgba(0,0,0,0.35);
            font-size: 0.7em;
        }

        @keyframes spinner-grow {
            0% {
                transform: scale(0);
            }
            50% {
                opacity: 1;
                transform: none;
            }
        }

        @keyframes blinker {
            50% {
                opacity: 0;
            }
        }

        @keyframes shimmer {
            0% {
                background-position: -200% 0;
            }
            100% {
                background-position: 200% 0;
            }
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        /* Responsive design */
        @media (max-width: 576px) {
            .amw-widget-img-container {
                flex: 0 0 25%;
                max-width: 25%;
            }
            
            .amw-widget-btn-warning {
                display: none !important;
            }
            
            .amw-widget-text {
                display: none !important;
            }
        }
    `;

    /**
     * Injects CSS into the page
     */
    function injectCSS() {
        if (document.getElementById('amw-widget-styles')) {
            return; // CSS already injected
        }

        const style = document.createElement('style');
        style.id = 'amw-widget-styles';
        style.textContent = WIDGET_CSS;
        document.head.appendChild(style);
    }

    /**
     * Generates lazy loading placeholder HTML
     */
    function generateLazyPlaceholderHTML(language) {
        const lang = WIDGET_CONFIG.languages[language] || WIDGET_CONFIG.languages.fr;
        
        return `
            <div class="amw-widget-lazy-placeholder">
                <div class="amw-widget-lazy-icon"></div>
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
            <span class="amw-widget-error-icon">⚠️</span>
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
     * Generates widget HTML
     */
    function generateWidgetHTML(productId, language) {
        const lang = WIDGET_CONFIG.languages[language] || WIDGET_CONFIG.languages.fr;
        
        return `
            <a href="#" class="amw-widget-main-link" target="_blank" rel="sponsored nofollow">
                <div class="amw-widget-img-container">
                    <img src="" alt="Amazon product" class="amw-widget-img"/>
                </div>

                <div class="amw-widget-content">
                    <div class="amw-widget-body">
                        <div class="amw-widget-title">
                            <span class="amw-widget-caption"></span>
                        </div>
                       
                        <div class="amw-widget-buttons">
                            <span class="amw-widget-btn amw-widget-btn-success amw-widget-price" role="button"></span>
                            <span class="amw-widget-btn amw-widget-btn-warning" role="button">${lang.buy}</span>
                        </div>

                        <p class="amw-widget-text">
                            <span class="amw-widget-timestamp"></span>
                        </p>
                    </div>

                    <div class="amw-widget-banner">
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

        return new Promise((resolve, reject) => {
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
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}`);
                    }
                    return response.json();
                })
                .then(resolve, reject)
                .finally(() => clearTimeout(fetchTimeout));
        }).catch(error => {
            console.error(`Error loading product ${productId} (attempt ${attempt}):`, error);
            if (attempt >= WIDGET_CONFIG.api.retryAttempts) {
                throw error;
            }
            return new Promise(resolve => setTimeout(resolve, WIDGET_CONFIG.api.retryDelay))
                .then(() => requestProduct(productId, attempt + 1));
        });
    }

    function getCachedProduct(cacheKey) {
        const cached = productCache.get(cacheKey);
        return cached && (Date.now() - cached.timestamp < WIDGET_CONFIG.performance.cacheExpiry) ? cached.data : null;
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

        fetchProduct(productId, cacheKey).then(product => {
            if (product === null) {
                widgetElement.innerHTML = generateErrorPlaceholderHTML(productId, language, 'not_found');
                console.log(`Amazon product not found: ${productId}`);
                return;
            }
            updateWidgetWithData(product, widgetElement, language);
        }, error => {
            const errorType = error && error.name === 'TimeoutError' ? 'timeout' : 'network_error';
            widgetElement.innerHTML = generateErrorPlaceholderHTML(productId, language, errorType);
        });
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
            price.innerHTML = sanitizeText(product.price) + `<span class="amw-widget-badge">-${savings}%<span class="amw-widget-visually-hidden">Savings</span></span>`;
        }

        injectJsonLd(product);

        spinner.style.display = 'none';
        img.style.display = 'block';
        content.style.display = 'block';
        body.style.display = 'block';
    }

    /**
     * Simple client-side cache for product data
     */
    const productCache = new Map();
    // Pending product promises by cache key, shared by widgets showing the same product
    const activeRequests = new Map();

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
        }
    };

    // Automatic initialization
    init();

})();
