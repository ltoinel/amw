/**
 * Amazon Widget HTML Script
 * This script automatically transforms all <div class="amazon" id="productId"></div> elements
 * into functional Amazon product widgets.
 * 
 * Usage:
 * 1. Include this script
 * 2. Create div elements with class="amazon" and id="PRODUCT_ID"
 * 3. Widgets load automatically on page load
 */

(function() {
    'use strict';

    // Widget configuration
    const WIDGET_CONFIG = {

        apiBaseUrl: window.location.origin+"/item",
        
        // Performance settings
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

        // API configuration
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
     * Sanitizes text content to prevent XSS
     */
    /**
     * Sanitize text for innerHTML usage (prevents XSS)
     * Note: Not needed when using textContent, which already escapes HTML
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
            .slice(0, 1000); // Limite de longueur pour sécurité
    }

    /**
     * Generates widget HTML
     */
    function generateWidgetHTML(productId, language) {
        const lang = WIDGET_CONFIG.languages[language] || WIDGET_CONFIG.languages.fr;
        
        return `
            <a href="#" class="amw-widget-main-link" target="_blank" rel="nofollow">
                <div class="amw-widget-img-container">
                    <img src="" alt="Amazon product" class="amw-widget-img"/>
                </div>

                <div class="amw-widget-content">
                    <div class="amw-widget-body">
                        <h1 class="amw-widget-title">
                            <span class="amw-widget-caption"></span>
                        </h1>
                       
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
     * Loads product data from API with retry logic
     */
    function loadProductDataWithRetry(productId, widgetElement, language, attempt = 1) {
        const lang = WIDGET_CONFIG.languages[language] || WIDGET_CONFIG.languages.fr;
        
        // Check cache first
        const cacheKey = `${productId}_${language}`;
        const cached = productCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp < WIDGET_CONFIG.performance.cacheExpiry)) {
            updateWidgetWithData(cached.data, widgetElement, language);
            return;
        }

        // Prevent duplicate requests
        if (activeRequests.has(cacheKey)) {
            return;
        }
        activeRequests.add(cacheKey);

        const url = `${WIDGET_CONFIG.apiBaseUrl}/product?id=${productId}`;

        const fetchTimeout = setTimeout(() => {
            console.error(`Timeout loading product ${productId} (attempt ${attempt})`);
            if (attempt < WIDGET_CONFIG.api.retryAttempts) {
                setTimeout(() => {
                    loadProductDataWithRetry(productId, widgetElement, language, attempt + 1);
                }, WIDGET_CONFIG.api.retryDelay);
            } else {
                widgetElement.innerHTML = generateErrorPlaceholderHTML(productId, language, 'timeout');
            }
        }, WIDGET_CONFIG.api.timeout);

        fetch(url)
            .then(response => {
                clearTimeout(fetchTimeout);
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                return response.json();
            })
            .then(product => {
                activeRequests.delete(cacheKey);
                
                if (product === null) {
                    widgetElement.innerHTML = generateErrorPlaceholderHTML(productId, language, 'not_found');
                    console.log(`Amazon product not found: ${productId}`);
                    return;
                }

                // Cache the product data
                productCache.set(cacheKey, {
                    data: product,
                    timestamp: Date.now()
                });

                updateWidgetWithData(product, widgetElement, language);
            })
            .catch(error => {
                activeRequests.delete(cacheKey);
                clearTimeout(fetchTimeout);
                console.error(`Error loading product ${productId} (attempt ${attempt}):`, error);
                
                if (attempt < WIDGET_CONFIG.api.retryAttempts) {
                    setTimeout(() => {
                        loadProductDataWithRetry(productId, widgetElement, language, attempt + 1);
                    }, WIDGET_CONFIG.api.retryDelay);
                } else {
                    widgetElement.innerHTML = generateErrorPlaceholderHTML(productId, language, 'network_error');
                }
            });
    }

    /**
     * Injects JSON-LD structured data for a product into the page
     */
    function injectJsonLd(product) {
        const jsonLd = {
            '@context': 'https://schema.org',
            '@type': 'Product',
            'name': product.title || '',
            'image': product.image || '',
            'description': product.title || '',
            'offers': {
                '@type': 'Offer',
                'priceCurrency': product.currency || 'EUR',
                'price': product.price !== -1 ? (function(p) {
                    var s = String(p).replace(/[^0-9.,]/g, '');
                    return s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
                })(product.price) : '0',
                'availability': product.price !== -1 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
                'url': product.url || ''
            }
        };

        // Add brand if available
        if (product.brand) {
            jsonLd['brand'] = {
                '@type': 'Brand',
                'name': product.brand
            };
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

        // Fill in data with sanitization
        img.src = product.image || '';
        img.onerror = function() { this.style.display = 'none'; };
        
        // Use textContent for safe insertion (no need to sanitize, textContent escapes automatically)
        const productTitle = product.title || 'Produit Amazon';
        caption.textContent = productTitle.length > 70 ? productTitle.slice(0, 67) + '...' : productTitle;
        
        // Set the main link URL
        const mainLink = widgetElement.querySelector('.amw-widget-main-link');
        if (mainLink) {
            mainLink.href = product.url || '#';
        }
        
        timestamp.textContent = lang.update + new Date(product.timestamp).toLocaleString();

        // Price (use textContent for safe insertion)
        if (product.price === -1) {
            price.textContent = lang.not_available;
        } else {
            price.textContent = product.price;
        }

        // Discounts (use innerHTML only for badge span which is safe static content)
        if (product.savings && product.savings !== 0) {
            price.innerHTML = sanitizeText(product.price) + `<span class="amw-widget-badge">-${product.savings}%<span class="amw-widget-visually-hidden">Savings</span></span>`;
        }

        // Inject JSON-LD structured data
        injectJsonLd(product);

        // Hide spinner and show content
        spinner.style.display = 'none';
        img.style.display = 'block';
        content.style.display = 'block';
        body.style.display = 'block';
    }

    /**
     * Loads product data from API (legacy function for compatibility)
     */
    function loadProductData(productId, widgetElement, language) {
        loadProductDataWithRetry(productId, widgetElement, language, 1);
    }

    /**
     * Simple client-side cache for product data
     */
    const productCache = new Map();
    const activeRequests = new Set();

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
                    
                    // Load the actual widget content
                    loadActualWidget(element, productId, language);
                    
                    // Stop observing this element
                    lazyLoadObserver.unobserve(element);
                }
            });
        }, options);
    }

    /**
     * Loads the actual widget content (called when widget becomes visible)
     */
    function loadActualWidget(element, productId, language) {
        // Replace lazy placeholder with actual widget HTML
        element.innerHTML = generateWidgetHTML(productId, language);
        element.className = 'amw-widget';
        
        // Load product data
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

        // Store data for lazy loading
        element.setAttribute('data-product-id', productId);
        element.setAttribute('data-language', language);

        // Set up lazy loading placeholder
        element.className = 'amw-widget amw-widget-lazy';
        element.innerHTML = generateLazyPlaceholderHTML(language);

        // Add to lazy loading observer
        if (lazyLoadObserver) {
            lazyLoadObserver.observe(element);
        } else {
            // Fallback: load immediately if observer not available
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

        // Replace element content
        element.className = 'amw-widget';
        element.innerHTML = generateWidgetHTML(productId, language);

        // Load product data
        loadProductData(productId, element, language);
    }

    /**
     * Initializes all widgets on the page
     */
    function initializeWidgets() {
        // Inject CSS
        injectCSS();

        // Create lazy loading observer if enabled
        if (WIDGET_CONFIG.lazyLoading.enabled) {
            lazyLoadObserver = createLazyLoadObserver();
        }

        // Find all elements with class="amw"
        const amwElements = document.querySelectorAll('div.amw');
        
        // Choose loading strategy based on configuration
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
                        // Check if the added node is an AMW widget
                        if (node.matches && node.matches('div.amw')) {
                            if (WIDGET_CONFIG.lazyLoading.enabled) {
                                transformToLazyWidget(node);
                            } else {
                                transformToWidget(node);
                            }
                        }
                        // Check descendants
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
