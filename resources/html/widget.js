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
        
        // Supported languages
        languages: {
            fr: {
                buy: '➕ Plus d\'infos',
                update: '↻ Dernière mise à jour : ',
                not_available: "Non disponible",
                loading: "Chargement..."
            },
            es: {
                buy: '🚀 Yo voy !',
                update: '↻ Ultima actualización : ',
                not_available: "No disponible",
                loading: "Cargando..."
            },
            en: {
                buy: '🚀 Let\'s go !',
                update: '↻ Last product update : ',
                not_available: "Not available",
                loading: "Loading..."
            },
            de: {
                buy: '🚀 Los geht\'s!',
                update: '↻ Letzte Aktualisierung : ',
                not_available: "Nicht verfügbar",
                loading: "Wird geladen..."
            },
            it: {
                buy: '🚀 Andiamo!',
                update: '↻ Ultimo aggiornamento : ',
                not_available: "Non disponibile",
                loading: "Caricamento..."
            },
            pt: {
                buy: '🚀 Vamos lá!',
                update: '↻ Última atualização : ',
                not_available: "Indisponível",
                loading: "Carregando..."
            },
            nl: {
                buy: '🚀 Laten we gaan!',
                update: '↻ Laatste update : ',
                not_available: "Niet beschikbaar",
                loading: "Laden..."
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
            border-radius: 10px;
            overflow: hidden;
            margin: 10px 0;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            font-family: ubuntu, sans-serif;
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
            flex: 0 0 20%;
            max-width: 20%;
        }

        .amw-widget-img {
            width: 100%;
            height: auto;
            border-radius: 8px 0 0 8px;
            transform-origin: 0%;
            transition: transform 1s, filter 3s ease-in-out;
            display: none;
        }

        .amw-widget-img:hover {
            transform: scale(1.1);
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
            font-size: 0.9em;
            transition: background-color 0.2s;
        }

        .amw-widget-btn-success {
            background-color: #28a745;
            color: white;
        }


        .amw-widget-btn-warning {
            background-color: #f3a81dff;
            color: #212529;
        }

        .amw-widget-badge {
            display: inline-block;
            padding: 0.25em 0.4em;
            font-size: 0.75em;
            font-weight: 700;
            line-height: 1;
            text-align: center;
            white-space: nowrap;
            vertical-align: baseline;
            border-radius: 0.375rem;
            position: absolute;
            top: 0;
            left: 100%;
            transform: translate(-50%, -50%);
            background-color: #dc3545;
            color: white;
            border-radius: 50rem;
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

        .amw-widget-timestamp{
            margin-top: 10px;
            display: block;     
            font-size: 0.7em;
            color: #bbb;
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
     * Generates widget HTML
     */
    function generateWidgetHTML(productId, language) {
        const lang = WIDGET_CONFIG.languages[language] || WIDGET_CONFIG.languages.fr;
        
        return `
            <div class="amw-widget-img-container">
                <a href="#" class="amw-widget-link" target="_blank">
                    <img src="" alt="Amazon product" class="amw-widget-img"/>
                </a>
            </div>

            <div class="amw-widget-content">
                <div class="amw-widget-body">
                    <h1 class="amw-widget-title">
                        <a href="#" class="amw-widget-caption" target="_blank" rel="nofollow"></a>
                    </h1>
                   
                    <a href="#" class="amw-widget-btn amw-widget-btn-success amw-widget-price amw-widget-link" role="button" target="_blank" rel="nofollow"></a>

                    <a href="#" class="amw-widget-btn amw-widget-btn-warning amw-widget-link" role="button" target="_blank" rel="nofollow">
                       <span class="amw-widget-buy">${lang.buy}</span>
                    </a>

                    <p class="amw-widget-text">
                        <span class="amw-widget-timestamp"></span>
                    </p>
                </div>
            </div>

            <div class="amw-widget-spinner">
                <div class="amw-widget-spinner-grow" role="status">
                    <span class="amw-widget-visually-hidden">${lang.loading}</span>
                </div>
            </div>
        `;
    }

    /**
     * Loads product data from API
     */
    function loadProductData(productId, widgetElement, language) {
        const lang = WIDGET_CONFIG.languages[language] || WIDGET_CONFIG.languages.fr;
        const url = `${WIDGET_CONFIG.apiBaseUrl}/product?id=${productId}`;

        fetch(url)
            .then(response => response.json())
            .then(product => {
                if (product === null) {
                    widgetElement.style.display = 'none';
                    console.log(`Amazon product not found: ${productId}`);
                    return;
                }

                // Update widget elements
                const img = widgetElement.querySelector('.amw-widget-img');
                const caption = widgetElement.querySelector('.amw-widget-caption');
                const price = widgetElement.querySelector('.amw-widget-price');
                const timestamp = widgetElement.querySelector('.amw-widget-timestamp');
                const links = widgetElement.querySelectorAll('.amw-widget-link');
                const spinner = widgetElement.querySelector('.amw-widget-spinner');
                const content = widgetElement.querySelector('.amw-widget-content');
                const body = widgetElement.querySelector('.amw-widget-body');

                // Fill in data
                img.src = product.image;
                caption.textContent = product.title.length > 70 ? product.title.slice(0, 67) + '...' : product.title;
                caption.href = product.url;
                
                links.forEach(link => link.href = product.url);
                
                timestamp.textContent = lang.update + new Date(product.timestamp).toLocaleString();

                // Price
                if (product.price == -1) {
                    price.textContent = lang.not_available;
                } else {
                    price.textContent = product.price;
                }

                // Discounts
                if (product.savings != 0) {
                    price.innerHTML = product.price + `<span class="amw-widget-badge">-${product.savings}%<span class="amw-widget-visually-hidden">Savings</span></span>`;
                }

                // Hide spinner and show content
                spinner.style.display = 'none';
                img.style.display = 'block';
                content.style.display = 'block';
                body.style.display = 'block';
            })
            .catch(error => {
                console.error(`Error loading product ${productId}:`, error);
                widgetElement.style.display = 'none';
            });
    }

    /**
     * Transforms a div element into a widget
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

        // Find all elements with class="amw"
        const amwElements = document.querySelectorAll('div.amw');
        
        amwElements.forEach(transformToWidget);
        
        console.log(`Initialized ${amwElements.length} AMW widgets`);
    }

    /**
     * Observer pour détecter les nouveaux widgets ajoutés dynamiquement
     */
    function setupMutationObserver() {
        const observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
                mutation.addedNodes.forEach(function(node) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        // Vérifier si le noeud ajouté est un widget AMW
                        if (node.matches && node.matches('div.amw')) {
                            transformToWidget(node);
                        }
                        // Vérifier les descendants
                        const amwElements = node.querySelectorAll && node.querySelectorAll('div.amw');
                        if (amwElements) {
                            amwElements.forEach(transformToWidget);
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
     * Point d'entrée principal
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

    // API publique
    window.AmazonWidget = {
        init: init,
        transformElement: transformToWidget,
        config: WIDGET_CONFIG
    };

    // Initialisation automatique
    init();

})();