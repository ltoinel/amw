/**
 * Amazon Modern Widgets - browser widget.
 *
 * Turns every <div class="amw" id="ASIN"></div> of the host page into a product card
 * (image, title, price, affiliate link), including elements added after page load.
 * The display language comes from data-lang on the element, the page's <html lang>, then
 * the browser languages, matched on their primary subtag (en-US -> en); English otherwise.
 *
 * Runs on third-party pages: everything coming from the API is treated as untrusted
 * and inserted with textContent, sanitizeText() or safeUrl().
 */

(function() {
    'use strict';

    // The settings of this site, when the portal set its own (AMW_SITE_SETTINGS), replace those of
    // every site before anything reads them; null removes one. Only the AMW_ globals of the server.
    (function applySiteSettings() {
        const bySite = window.AMW_SITE_SETTINGS;
        const own = bySite && typeof bySite === 'object' && Object.prototype.hasOwnProperty.call(bySite, window.location.host)
            ? bySite[window.location.host] : null;
        if (!own || typeof own !== 'object') return;
        Object.keys(own).forEach(name => {
            if (!/^AMW_[A-Z_]+$/.test(name) || name === 'AMW_SITE_SETTINGS' || name === 'AMW_ALLOWED_SITES') return;
            if (own[name] === null) {
                delete window[name];
            } else {
                window[name] = own[name];
            }
        });
    })();

    /**
     * The preview of the portal (<script data-preview>): a sample card with the theme, effect and
     * label being chosen, whatever the settings and tests of the server. It sends no request and
     * no beacon, so that looking at a design counts nothing.
     */
    const PREVIEW = (function readPreview() {
        const script = document.currentScript;
        const raw = script && script.getAttribute('data-preview');
        if (!raw) return null;
        try {
            const preview = JSON.parse(raw);
            return preview && typeof preview === 'object' && preview.product && typeof preview.product === 'object' ? preview : null;
        } catch (e) {
            return null;
        }
    })();
    if (PREVIEW) {
        ['AMW_THEMES', 'AMW_EFFECTS', 'AMW_LABELS', 'AMW_STUFFING', 'AMW_ALLOWED_SITES'].forEach(name => { delete window[name]; });
        [['AMW_DEFAULT_THEME', PREVIEW.theme], ['AMW_EFFECT', PREVIEW.effect], ['AMW_LABEL', PREVIEW.label]].forEach(([name, value]) => {
            if (typeof value === 'string') {
                window[name] = value;
            } else {
                delete window[name];
            }
        });
    }

    // Prepended by the server from Server.allowedSites. This only spares another site an error
    // card: the API is what refuses it, and a page could change this value on its own
    if (Array.isArray(window.AMW_ALLOWED_SITES) && window.AMW_ALLOWED_SITES.indexOf(window.location.host) === -1) {
        return;
    }

    // Only available while the script first runs, hence captured here
    const currentScript = document.currentScript;
    // <script data-debug> (or AmwWidget.setApiConfig({ debug: true })): this runs on third-party
    // pages, whose console must stay quiet unless something is wrong
    let debugEnabled = Boolean(currentScript && currentScript.hasAttribute('data-debug'));

    function debugLog(message) {
        if (debugEnabled) {
            console.log(`AMW: ${message}`);
        }
    }

    // Published next to widget.js by scripts/build-widgets.js
    const WIDGET_CSS_FILE = 'widget.css';
    // Written in full: the build replaces each quoted name by its content-hashed copy
    const THEME_CSS_FILES = {
        native: 'themes/native.css',
        shelf: 'themes/shelf.css',
        receipt: 'themes/receipt.css',
        blueprint: 'themes/blueprint.css',
        outdoor: 'themes/outdoor.css',
        terminal: 'themes/terminal.css',
        magazine: 'themes/magazine.css',
        pastel: 'themes/pastel.css',
        neon: 'themes/neon.css',
        denim: 'themes/denim.css',
        leather: 'themes/leather.css',
        canvas: 'themes/canvas.css',
        alpine: 'themes/alpine.css',
        christmas: 'themes/christmas.css',
        halloween: 'themes/halloween.css',
        blackfriday: 'themes/blackfriday.css'
    };

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

    // Must match WIDGET_THEMES in src/server/Settings.ts and the files of THEME_CSS_FILES
    const THEMES = ['default', 'native', 'shelf', 'receipt', 'blueprint', 'outdoor', 'terminal', 'magazine', 'pastel', 'neon', 'denim', 'leather', 'canvas', 'alpine', 'christmas', 'halloween', 'blackfriday'];

    /** A known theme name, or null: an unknown name must not leave a card half styled. */
    function parseTheme(value) {
        if (typeof value !== 'string' || value.trim() === '') {
            return null;
        }
        const theme = value.trim().toLowerCase();
        if (THEMES.indexOf(theme) === -1) {
            console.warn(`AMW: unknown theme ignored: ${value}`);
            return null;
        }
        return theme;
    }

    /** An attribute present without a value is on, like a boolean HTML attribute. */
    function parseFlag(value) {
        if (value === null || value === undefined || value === false) {
            return false;
        }
        const text = String(value).trim().toLowerCase();
        return text !== 'off' && text !== 'false';
    }

    function parseDisclosure(value) {
        if (value === null || value === undefined || value === true) {
            return true;
        }
        if (value === false) {
            return false;
        }
        const text = String(value).trim();
        if (text === '' || text.toLowerCase() === 'on' || text.toLowerCase() === 'true') {
            return true;
        }
        return text.toLowerCase() === 'off' || text.toLowerCase() === 'false' ? false : text.slice(0, 300);
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
            // Early enough for the product to arrive before the card, invisible until then, scrolls in
            rootMargin: '300px',
            threshold: 0.1 // Trigger when 10% of element is visible
        },

        // Affiliate disclosure under each card (required by the Amazon Associates agreement and,
        // in France, by the law on identifying advertising): true for the localized text, false
        // to hide it (the site then discloses elsewhere), or a custom text.
        // <script data-disclosure="off"> or data-disclosure="custom text" sets it.
        disclosure: parseDisclosure(currentScript && currentScript.getAttribute('data-disclosure')),
        // <script data-disclosure-once>: the disclosure under the first card displayed on the
        // page only, rather than under each, so a page of cards does not repeat it
        disclosureOnce: parseFlag(currentScript && currentScript.getAttribute('data-disclosure-once')),

        // <script data-theme="shelf"> chooses the design for the site; otherwise the server's
        // Server.theme, which it prepends to the stable widget.js as AMW_DEFAULT_THEME.
        theme: parseTheme(currentScript && currentScript.getAttribute('data-theme')) ||
            parseTheme(window.AMW_DEFAULT_THEME) || 'default',

        // The card of every widget without data-amw-template: <script data-template="compact">
        // or setApiConfig({ template }); an unknown name keeps the default card. Set below, once
        // the templates are known.
        template: 'default',

        api: {
            timeout: 10000, // 10 seconds
            retryAttempts: 2,
            retryDelay: 1000 // 1 second
        },
        
        // Built-in languages; AmwWidget.setTranslations() adds languages or overrides labels
        languages: {
            fr: {
                default_title: "Produit Amazon",
                buy: 'Voir l\'offre sur Amazon',
                buy_no_price: 'Voir le prix sur Amazon',
                // The button of a banner of the site, outside Amazon
                learn_more: 'En savoir plus',
                // Other button labels the portal can choose or compare (offer is buy, price is buy_no_price)
                label_view: 'Voir sur Amazon',
                label_buy: 'Acheter sur Amazon',
                price_disclaimer: 'Prix et disponibilité au {date}, susceptibles de changer',
                disclosure: 'En tant que Partenaire Amazon, je réalise un bénéfice sur les achats remplissant les conditions requises.',
                not_available: "Non disponible",
                loading: "Chargement...",
                error_network: "Erreur de connexion",
                error_timeout: "Délai dépassé",
                error_retry_message: "Vérifiez votre connexion ou réessayez plus tard",
                savings: 'de réduction',
                flash_sale: 'Vente flash',
                sponsored: 'lien sponsorisé',
                new_tab: 's\'ouvre dans un nouvel onglet'
            },
            es: {
                default_title: "Producto de Amazon",
                buy: 'Ver la oferta en Amazon',
                buy_no_price: 'Ver el precio en Amazon',
                // The button of a banner of the site, outside Amazon
                learn_more: 'Más información',
                // Other button labels the portal can choose or compare (offer is buy, price is buy_no_price)
                label_view: 'Ver en Amazon',
                label_buy: 'Comprar en Amazon',
                price_disclaimer: 'Precio y disponibilidad a {date}, sujetos a cambios',
                disclosure: 'En calidad de Afiliado de Amazon, obtengo ingresos por las compras adscritas que cumplen los requisitos aplicables.',
                not_available: "No disponible",
                loading: "Cargando...",
                error_network: "Error de conexión",
                error_timeout: "Tiempo de espera agotado",
                error_retry_message: "Verifique su conexión o inténtelo de nuevo más tarde",
                savings: 'de descuento',
                flash_sale: 'Oferta relámpago',
                sponsored: 'enlace patrocinado',
                new_tab: 'se abre en una nueva pestaña'
            },
            en: {
                default_title: "Amazon product",
                buy: 'See the offer on Amazon',
                buy_no_price: 'Check the price on Amazon',
                // The button of a banner of the site, outside Amazon
                learn_more: 'Learn more',
                // Other button labels the portal can choose or compare (offer is buy, price is buy_no_price)
                label_view: 'View on Amazon',
                label_buy: 'Buy on Amazon',
                price_disclaimer: 'Price and availability as of {date}, subject to change',
                disclosure: 'As an Amazon Associate I earn from qualifying purchases.',
                not_available: "Not available",
                loading: "Loading...",
                error_network: "Connection error",
                error_timeout: "Request timeout",
                error_retry_message: "Check your connection or try again later",
                savings: 'off',
                flash_sale: 'Lightning deal',
                sponsored: 'sponsored link',
                new_tab: 'opens in a new tab'
            },
            de: {
                default_title: "Amazon-Produkt",
                buy: 'Zum Angebot bei Amazon',
                buy_no_price: 'Preis bei Amazon ansehen',
                // The button of a banner of the site, outside Amazon
                learn_more: 'Mehr erfahren',
                // Other button labels the portal can choose or compare (offer is buy, price is buy_no_price)
                label_view: 'Bei Amazon ansehen',
                label_buy: 'Bei Amazon kaufen',
                price_disclaimer: 'Preis und Verfügbarkeit am {date}, Änderungen vorbehalten',
                disclosure: 'Als Amazon-Partner verdiene ich an qualifizierten Verkäufen.',
                not_available: "Nicht verfügbar",
                loading: "Wird geladen...",
                error_network: "Verbindungsfehler",
                error_timeout: "Zeitüberschreitung",
                error_retry_message: "Überprüfen Sie Ihre Verbindung oder versuchen Sie es später erneut",
                savings: 'Rabatt',
                flash_sale: 'Blitzangebot',
                sponsored: 'gesponserter Link',
                new_tab: 'öffnet in einem neuen Tab'
            },
            it: {
                default_title: "Prodotto Amazon",
                buy: 'Vedi l\'offerta su Amazon',
                buy_no_price: 'Vedi il prezzo su Amazon',
                // The button of a banner of the site, outside Amazon
                learn_more: 'Scopri di più',
                // Other button labels the portal can choose or compare (offer is buy, price is buy_no_price)
                label_view: 'Vedi su Amazon',
                label_buy: 'Acquista su Amazon',
                price_disclaimer: 'Prezzo e disponibilità al {date}, soggetti a modifiche',
                disclosure: 'In qualità di Affiliato Amazon io ricevo un guadagno dagli acquisti idonei.',
                not_available: "Non disponibile",
                loading: "Caricamento...",
                error_network: "Errore di connessione",
                error_timeout: "Timeout della richiesta",
                error_retry_message: "Controlla la tua connessione o riprova più tardi",
                savings: 'di sconto',
                flash_sale: 'Offerta lampo',
                sponsored: 'link sponsorizzato',
                new_tab: 'si apre in una nuova scheda'
            },
            pt: {
                default_title: "Produto da Amazon",
                buy: 'Ver a oferta na Amazon',
                buy_no_price: 'Ver o preço na Amazon',
                // The button of a banner of the site, outside Amazon
                learn_more: 'Saiba mais',
                // Other button labels the portal can choose or compare (offer is buy, price is buy_no_price)
                label_view: 'Ver na Amazon',
                label_buy: 'Comprar na Amazon',
                price_disclaimer: 'Preço e disponibilidade em {date}, sujeitos a alterações',
                disclosure: 'Como Associado da Amazon, ganho com compras qualificadas.',
                not_available: "Indisponível",
                loading: "Carregando...",
                error_network: "Erro de conexão",
                error_timeout: "Tempo limite esgotado",
                error_retry_message: "Verifique sua conexão ou tente novamente mais tarde",
                savings: 'de desconto',
                flash_sale: 'Oferta relâmpago',
                sponsored: 'link patrocinado',
                new_tab: 'abre em uma nova aba'
            },
            nl: {
                default_title: "Amazon-product",
                buy: 'Bekijk het aanbod op Amazon',
                buy_no_price: 'Bekijk de prijs op Amazon',
                // The button of a banner of the site, outside Amazon
                learn_more: 'Meer informatie',
                // Other button labels the portal can choose or compare (offer is buy, price is buy_no_price)
                label_view: 'Bekijk op Amazon',
                label_buy: 'Koop op Amazon',
                price_disclaimer: 'Prijs en beschikbaarheid op {date}, onder voorbehoud van wijzigingen',
                disclosure: 'Als Amazon-partner verdien ik aan in aanmerking komende aankopen.',
                not_available: "Niet beschikbaar",
                loading: "Laden...",
                error_network: "Verbindingsfout",
                error_timeout: "Verzoek time-out",
                error_retry_message: "Controleer uw verbinding of probeer het later opnieuw",
                savings: 'korting',
                flash_sale: 'Flitsaanbieding',
                sponsored: 'gesponsorde link',
                new_tab: 'opent in een nieuw tabblad'
            }
        }
    };


    // Used when none of the page, the element and the browser names a known language
    const DEFAULT_LANGUAGE = 'en';

    /**
     * Returns the translations of a language, English for an unknown one (whose labels
     * setTranslations() may then override one by one).
     */
    function getStrings(language) {
        return hasLanguage(language) ? WIDGET_CONFIG.languages[language] : WIDGET_CONFIG.languages[DEFAULT_LANGUAGE];
    }

    // Own properties only: lang="constructor" must not resolve to Object.prototype members
    function hasLanguage(language) {
        return Object.prototype.hasOwnProperty.call(WIDGET_CONFIG.languages, language);
    }

    /**
     * The known language matching a BCP 47 tag, exactly or by its primary subtag
     * ("pt-BR" -> "pt", "EN" -> "en"), or null.
     */
    function matchLanguage(tag) {
        if (typeof tag !== 'string' || tag.trim() === '') {
            return null;
        }
        const normalized = tag.trim().toLowerCase().replace(/_/g, '-');
        if (hasLanguage(normalized)) {
            return normalized;
        }
        const primary = normalized.split('-')[0];
        return hasLanguage(primary) ? primary : null;
    }

    /**
     * Picks the widget language from data-lang on the element, the page's <html lang>, then
     * the browser's preferred languages. Also returns the tag it came from, which keeps its
     * region for date formatting (en-GB writes day/month, en-US month/day).
     */
    function resolveLanguage(element) {
        const browser = (navigator.languages && navigator.languages.length > 0)
            ? Array.from(navigator.languages)
            : [navigator.language];
        const candidates = [element.getAttribute('data-lang'), document.documentElement.getAttribute('lang')].concat(browser);
        for (const tag of candidates) {
            const language = matchLanguage(tag);
            if (language) {
                return { language: language, locale: tag.trim().replace(/_/g, '-') };
            }
        }
        return { language: DEFAULT_LANGUAGE, locale: DEFAULT_LANGUAGE };
    }

    /**
     * Formats the update date for the language of the card, whatever the browser's locale.
     */
    function formatDate(timestamp, locale) {
        const date = new Date(timestamp);
        try {
            return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
        } catch (e) {
            // An invalid locale tag (RangeError), or a browser without Intl
            return date.toLocaleString();
        }
    }

    /**
     * URL of a stylesheet published next to this script (<path>/widget.css). When the script
     * URL is unknown (document.currentScript is null for scripts run by eval), the widget's server
     * is reached through the API base URL, which serves the same files.
     */
    function getStylesheetUrl(file) {
        try {
            if (currentScript && currentScript.src) {
                return new URL(file, currentScript.src).href;
            }
        } catch (e) {
            // Falls through to the API base URL
        }
        return `${WIDGET_CONFIG.apiBaseUrl}/${file}`;
    }

    function injectStylesheet(id, file) {
        if (document.getElementById(id)) {
            return;
        }
        const link = document.createElement('link');
        link.id = id;
        link.rel = 'stylesheet';
        link.href = getStylesheetUrl(file);
        document.head.appendChild(link);
    }

    /** The default design is part of the base stylesheet, so it needs no file of its own. */
    function injectThemeCSS(theme) {
        if (THEME_CSS_FILES[theme]) {
            injectStylesheet(`amw-widget-styles-${theme}`, THEME_CSS_FILES[theme]);
        }
    }

    /**
     * Loads the base stylesheet and the one of the active theme, together so that a card does not
     * show the default look for long. They are separate files so that browsers cache them apart
     * from the script; if one fails to load, widgets stay usable links, only less styled.
     */
    function injectCSS() {
        injectStylesheet('amw-widget-styles', WIDGET_CSS_FILE);
        injectThemeCSS(WIDGET_CONFIG.theme);
    }

    /**
     * Generates lazy loading placeholder HTML
     */
    function generateLazyPlaceholderHTML(language) {
        const lang = getStrings(language);
        
        return `
            <div class="amw-widget-lazy-placeholder">
                <div class="amw-widget-lazy-icon" aria-hidden="true"></div>
                <span>${sanitizeText(lang.loading)}</span>
            </div>
        `;
    }

    /**
     * Generates the placeholder of a product that could not be loaded (network error,
     * timeout); a product Amazon does not know hides the widget instead (see hideWidget).
     */
    function generateErrorPlaceholderHTML(language, errorType) {
        const lang = getStrings(language);
        const errorMessage = sanitizeText(errorType === 'timeout' ? lang.error_timeout : lang.error_network);

        return `
            <div class="amw-widget-error">
            <span class="amw-widget-error-icon" aria-hidden="true">⚠️</span>
            <div>${errorMessage}</div>
            <div class="amw-widget-error-retry-message">
                ${sanitizeText(lang.error_retry_message)}
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

    // Matches the server's ASIN validation: /click and /view reject any other id
    const ASIN_PATTERN = /^[A-Z0-9]{10}$/;

    /**
     * MD5 of an ASCII string, which a serialized URL always is. Web Crypto has no MD5 and only
     * exists on HTTPS pages. This is a cache key, not a security measure.
     */
    function md5(text) {
        const shifts = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
        const blocks = ((text.length + 8) >> 6) + 1;
        const words = new Array(blocks * 16).fill(0);
        for (let i = 0; i < text.length; i++) {
            words[i >> 2] |= (text.charCodeAt(i) & 0xff) << ((i % 4) * 8);
        }
        words[text.length >> 2] |= 0x80 << ((text.length % 4) * 8);
        words[blocks * 16 - 2] = text.length * 8;

        const state = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
        for (let block = 0; block < blocks; block++) {
            let [a, b, c, d] = state;
            for (let i = 0; i < 64; i++) {
                const round = i >> 4;
                const mix = [(b & c) | (~b & d), (d & b) | (~d & c), b ^ c ^ d, c ^ (b | ~d)][round];
                const word = [i, (5 * i + 1) % 16, (3 * i + 5) % 16, (7 * i) % 16][round];
                const sum = (a + mix + Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) + words[block * 16 + word]) | 0;
                const shift = shifts[round * 4 + i % 4];
                a = d;
                d = c;
                c = b;
                b = (b + ((sum << shift) | (sum >>> (32 - shift)))) | 0;
            }
            state[0] = (state[0] + a) | 0;
            state[1] = (state[1] + b) | 0;
            state[2] = (state[2] + c) | 0;
            state[3] = (state[3] + d) | 0;
        }
        return state.map(value => {
            let hex = '';
            for (let i = 0; i < 4; i++) {
                hex += ((value >>> (i * 8)) & 0xff).toString(16).padStart(2, '0');
            }
            return hex;
        }).join('');
    }

    /** Names the page for a widget without an id. Must match what the server derives from the Referer. */
    function getPageHash() {
        return md5(window.location.origin + window.location.pathname);
    }

    /** The ASIN for the statistics: only the API knows it behind a widget without an id. */
    function displayedProductId(product, widgetElement) {
        return widgetElement.getAttribute('data-product-id') || widgetElement.id || product.asin;
    }

    /**
     * Reports a click on the affiliate link. sendBeacon is queued by the browser
     * and survives the page unload, so navigation is never delayed; failures are
     * ignored because statistics must never break the widget.
     */
    function sendClickBeacon(productId) {
        if (PREVIEW || !ASIN_PATTERN.test(productId) || !navigator.sendBeacon) {
            return;
        }
        try {
            navigator.sendBeacon(`${WIDGET_CONFIG.apiBaseUrl}/click?id=${encodeURIComponent(productId)}${variantQuery()}`);
        } catch (e) {
            // Ignored on purpose, see above
        }
    }

    // Must match WIDGET_EFFECTS in src/server/Settings.ts and the amw-effect-* rules of widget.css
    const EFFECTS = ['none', 'fade', 'slide', 'zoom', 'pulse'];
    // Bumped whenever the stored format changes, so old entries are ignored
    const EFFECT_STORAGE_KEY = 'amw:effect:v1';
    const THEME_STORAGE_KEY = 'amw:theme:v1';

    /**
     * One of `pool` at random, kept for the tab session: no identifier leaves the browser, only
     * which group the cards belong to. A stored value the pool no longer holds is drawn again.
     */
    function drawVariant(storageKey, pool) {
        const storage = getSessionStorage();
        try {
            const stored = storage && storage.getItem(storageKey);
            if (pool.indexOf(stored) !== -1) {
                return stored;
            }
            const variant = pool[Math.floor(Math.random() * pool.length)];
            if (storage) {
                storage.setItem(storageKey, variant);
            }
            return variant;
        } catch (e) {
            // Without storage the group only lasts for the page
            return pool[Math.floor(Math.random() * pool.length)];
        }
    }

    /** The known names of a list the server prepended, or an empty list. */
    function knownNames(list, known) {
        return Array.isArray(list) ? list.filter(name => known.indexOf(name) !== -1) : [];
    }

    /**
     * The effect of this visitor, or null when effects are off. In compare mode (AMW_EFFECT) a tab
     * session keeps one of the effects chosen in the portal (AMW_EFFECTS), "none" being the
     * control group. Visitors who prefer reduced motion see nothing whatever their group, so they
     * are left out rather than counted as control.
     */
    function chooseEffect() {
        const mode = window.AMW_EFFECT;
        if (!mode || mode === 'none' || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
            return null;
        }
        if (EFFECTS.indexOf(mode) !== -1) {
            return mode;
        }
        if (mode !== 'compare') {
            return null;
        }
        const chosen = knownNames(window.AMW_EFFECTS, EFFECTS);
        return drawVariant(EFFECT_STORAGE_KEY, chosen.length >= 2 ? chosen : EFFECTS);
    }

    /**
     * The theme of this tab session when the portal compares themes (AMW_THEMES), or null. It
     * replaces data-theme and Server.theme, which would otherwise keep every visitor in one group.
     */
    function chooseTestTheme() {
        const themes = knownNames(window.AMW_THEMES, THEMES);
        return themes.length >= 2 ? drawVariant(THEME_STORAGE_KEY, themes) : null;
    }

    // Must match BUTTON_LABELS in src/server/Settings.ts
    const BUTTON_LABELS = ['offer', 'price', 'view', 'buy'];
    const LABEL_STORAGE_KEY = 'amw:label:v1';

    /** The label of this tab session when the portal compares labels (AMW_LABELS), or null. */
    function chooseTestLabel() {
        const labels = knownNames(window.AMW_LABELS, BUTTON_LABELS);
        return labels.length >= 2 ? drawVariant(LABEL_STORAGE_KEY, labels) : null;
    }

    const activeEffect = chooseEffect();
    const testTheme = chooseTestTheme();
    const testLabel = chooseTestLabel();
    // The label chosen in the portal, "offer" otherwise
    const activeLabel = testLabel || (BUTTON_LABELS.indexOf(window.AMW_LABEL) !== -1 ? window.AMW_LABEL : 'offer');

    /**
     * The text of the button of a card with an offer. A page that set its own with setTranslations
     * keeps it, whatever the portal chose: run a label test on pages that keep the built-in labels.
     */
    function buttonLabel(lang) {
        if (lang.custom_buy) return lang.buy;
        if (activeLabel === 'price') return lang.buy_no_price || lang.buy;
        return lang[`label_${activeLabel}`] || lang.buy;
    }
    if (testTheme) {
        WIDGET_CONFIG.theme = testTheme;
    }

    /** The groups the beacons report. setApiConfig({ theme }) takes the page out of the theme test. */
    function variantQuery() {
        return (activeEffect ? `&effect=${activeEffect}` : '') +
            (testTheme && WIDGET_CONFIG.theme === testTheme ? `&theme=${testTheme}` : '') +
            (testLabel ? `&label=${testLabel}` : '');
    }

    // Cards shown within this delay share one beacon, so a page of widgets costs a single request
    const VIEW_BEACON_DELAY = 1000;
    // The server accepts at most 10 ids per /view call
    const MAX_VIEW_IDS = 10;
    let pendingViews = [];
    // null until the first view of the page: then whether this tab session had not seen it yet
    let visitPending = null;
    let viewBeaconTimer = null;
    // Bumped whenever the stored format changes, so old entries are ignored
    const VIEWS_STORAGE_KEY = 'amw:views:v1';
    // Bounds the space taken in the host site's sessionStorage (about 20 bytes per view)
    const MAX_STORED_VIEWS = 200;
    // In insertion order, so the oldest views are the ones dropped from the storage
    const countedViews = restoreCountedViews();

    /** A malformed or blocked storage only means that a card may be counted again. */
    function restoreCountedViews() {
        const storage = getSessionStorage();
        if (!storage) {
            return new Set();
        }
        try {
            const stored = JSON.parse(storage.getItem(VIEWS_STORAGE_KEY) || '[]');
            return new Set(Array.isArray(stored) ? stored : []);
        } catch (e) {
            return new Set();
        }
    }

    /**
     * Remembers a view for the session of the tab, on this device only: no cookie and no
     * identifier, so the server can count unique views without being able to recognise anyone.
     * @returns {boolean} false when this product was already counted on this page.
     */
    function markViewCounted(productId) {
        const view = `${getPageHash().slice(0, 8)}:${productId}`;
        if (countedViews.has(view)) {
            return false;
        }
        countedViews.add(view);
        const storage = getSessionStorage();
        if (storage) {
            try {
                storage.setItem(VIEWS_STORAGE_KEY, JSON.stringify(Array.from(countedViews).slice(-MAX_STORED_VIEWS)));
            } catch (e) {
                // A full storage only costs the persistence
            }
        }
        return true;
    }

    /**
     * Counts a displayed card, once per product, page and tab session. Products are served by
     * caches (CDN, browser, session) that never reach the server, so the widget is the only
     * place that sees every display.
     */
    function recordView(productId) {
        if (PREVIEW || !ASIN_PATTERN.test(productId) || !navigator.sendBeacon) {
            return;
        }
        // Read before this view is remembered: no view of this page yet in the tab session is a visit
        if (visitPending === null) {
            const page = `${getPageHash().slice(0, 8)}:`;
            visitPending = ![...countedViews].some(view => view.startsWith(page));
        }
        if (!markViewCounted(productId)) {
            return;
        }
        pendingViews.push(productId);
        if (viewBeaconTimer === null) {
            viewBeaconTimer = setTimeout(flushViews, VIEW_BEACON_DELAY);
        }
    }

    /** Failures are ignored for the same reason as the click beacon. */
    function flushViews() {
        clearTimeout(viewBeaconTimer);
        viewBeaconTimer = null;
        while (pendingViews.length > 0) {
            const ids = pendingViews.splice(0, MAX_VIEW_IDS);
            // The first views of the page in the tab session also count its visit, once
            const visit = visitPending === true ? '&visit=1' : '';
            if (visitPending === true) visitPending = false;
            try {
                navigator.sendBeacon(`${WIDGET_CONFIG.apiBaseUrl}/view?ids=${ids.join(',')}${variantQuery()}${visit}`);
            } catch (e) {
                // Ignored on purpose
            }
        }
    }

    // pagehide alone misses mobile browsers, which may discard a hidden page without firing it
    function flushViewsWhenHidden() {
        if (document.visibilityState === 'hidden') {
            flushViews();
        }
    }
    document.addEventListener('visibilitychange', flushViewsWhenHidden);
    window.addEventListener('pagehide', flushViews);

    // Makes the ids referenced by aria-describedby unique across the widgets of a page
    let widgetCount = 0;

    // The card templates of src/widgets/templates, inlined by the build (the tests load them).
    // Trusted markup of this repository: product data never goes through it as HTML.
    const CARD_TEMPLATES = /* @amw-templates */ (window.AMW_CARD_TEMPLATES || {});
    // Must match TEMPLATE_NAME in scripts/widget-templates.js
    const TEMPLATE_NAME = /^[a-z][a-z0-9-]{0,31}$/;

    /** A known template name, or null: an unknown name falls back to the default card. */
    function parseTemplate(value) {
        if (typeof value !== 'string' || value.trim() === '') {
            return null;
        }
        const name = value.trim().toLowerCase();
        if (!TEMPLATE_NAME.test(name) || !Object.prototype.hasOwnProperty.call(CARD_TEMPLATES, name)) {
            console.warn(`AMW: unknown template ignored: ${value}`);
            return null;
        }
        return name;
    }

    WIDGET_CONFIG.template = parseTemplate(currentScript && currentScript.getAttribute('data-template')) || 'default';

    /**
     * Puts the card of the element's template (data-amw-template, or the template of the site)
     * in the element, with the static texts of its language; the product fills it later.
     */
    function renderCard(element, language) {
        const lang = getStrings(language);
        const name = parseTemplate(element.getAttribute('data-amw-template')) || WIDGET_CONFIG.template;
        const template = document.createElement('template');
        template.innerHTML = CARD_TEMPLATES[name] || CARD_TEMPLATES.default || '';
        const card = template.content;

        const texts = {
            buy: lang.buy,
            loading: lang.loading,
            notice: `(${lang.sponsored}, ${lang.new_tab})`
        };
        card.querySelectorAll('[data-amw-text]').forEach(node => {
            node.textContent = texts[node.getAttribute('data-amw-text')] || '';
            node.removeAttribute('data-amw-text');
        });

        const idPrefix = `amw-widget-${++widgetCount}`;
        const described = [];
        const timestamp = card.querySelector('.amw-widget-timestamp');
        if (timestamp) {
            timestamp.id = `${idPrefix}-update`;
            described.push(timestamp.id);
        }
        const disclosure = card.querySelector('.amw-widget-disclosure');
        if (disclosure && WIDGET_CONFIG.disclosure) {
            disclosure.id = `${idPrefix}-disclosure`;
            described.push(disclosure.id);
        } else if (disclosure) {
            disclosure.remove();
        }
        const link = card.querySelector('.amw-widget-main-link');
        if (link && described.length > 0) {
            link.setAttribute('aria-describedby', described.join(' '));
        }

        // Not replaceChildren: older Safari lacks it
        element.textContent = '';
        element.appendChild(card);
        if (name && name !== 'default') {
            element.setAttribute('data-amw-card', name);
        } else {
            element.removeAttribute('data-amw-card');
        }
    }

    /**
     * Fetches `url` in a request slot and resolves with `readResponse(response)`; rejects with a
     * TimeoutError when the whole exchange takes longer than the configured timeout.
     */
    function fetchLimited(url, readResponse, options) {
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

            const init = Object.assign({}, options);
            if (controller) {
                init.signal = controller.signal;
            }
            fetch(url, init)
                .then(readResponse)
                .then(resolve, reject)
                .finally(() => clearTimeout(fetchTimeout));
        }));
    }

    function waitRetryDelay() {
        return new Promise(resolve => setTimeout(resolve, WIDGET_CONFIG.api.retryDelay));
    }

    /**
     * Fetches a product, retrying on network errors and timeouts.
     * Resolves with the product (null when the API returns null), rejects once the retries are exhausted.
     */
    function requestProduct(productId, attempt, slot) {
        // Slot 0 keeps the plain URL: it shares its cache with the widgets of a page without an id
        const query = productId ? `id=${encodeURIComponent(productId)}` : `page=${getPageHash()}${slot ? `&slot=${slot}` : ''}`;
        const url = `${WIDGET_CONFIG.apiBaseUrl}/product?${query}`;
        // The server reads the page URL from the Referer: browsers reduce it to the origin for a
        // cross-origin API by default, and the page's own policy may remove it
        const options = productId ? undefined : { referrerPolicy: 'no-referrer-when-downgrade' };

        return fetchLimited(url, response => {
            // 404 means Amazon has no such item: a final answer, unlike 5xx and network errors
            if (response.status === 404) {
                return null;
            }
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            return response.json();
        }, options).catch(error => {
            console.error(`Error loading product ${productId} (attempt ${attempt}):`, error);
            if (attempt >= WIDGET_CONFIG.api.retryAttempts) {
                throw error;
            }
            return waitRetryDelay().then(() => requestProduct(productId, attempt + 1, slot));
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
    function fetchProduct(productId, cacheKey, slot) {
        if (PREVIEW) {
            // Relative links of the sample resolve against the preview page
            const sample = PREVIEW.product;
            const absolute = value => { try { return new URL(String(value), document.baseURI).href; } catch (e) { return ''; } };
            return Promise.resolve(Object.assign({}, sample, { image: absolute(sample.image), url: absolute(sample.url), timestamp: Date.now() }));
        }
        const pending = activeRequests.get(cacheKey);
        if (pending) {
            return pending;
        }

        const request = requestProduct(productId, 1, slot).then(product => {
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
        // The page is part of the key: this cache lasts across the pages of a session, and a widget
        // without an id would otherwise show the first article's product on all of them
        const slot = Number(widgetElement.getAttribute('data-amw-slot')) || 0;
        const cacheKey = `${productId || `page:${getPageHash()}:${slot}`}_${language}`;
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

        fetchProduct(productId, cacheKey, slot).then(product => {
            if (product === null) {
                hideWidget(widgetElement);
                debugLog(`Amazon does not know product ${productId}, widget hidden`);
                return;
            }
            widgetElement.removeAttribute('aria-live');
            updateWidgetWithData(product, widgetElement, language);
        }, error => {
            // The site owner promised no particular product here: an empty spot beats an error
            if (!productId) {
                hideWidget(widgetElement);
                return;
            }
            showError(widgetElement, language, error && error.name === 'TimeoutError' ? 'timeout' : 'network_error');
        });
    }

    /**
     * Removes a widget whose product Amazon does not know (withdrawn, wrong ASIN): readers
     * see nothing rather than an error, and the site owner finds it among the products to
     * replace in the admin portal. Inline display wins over the stylesheet's display: flex.
     */
    function hideWidget(widgetElement) {
        widgetElement.innerHTML = '';
        widgetElement.hidden = true;
        widgetElement.style.display = 'none';
        widgetElement.removeAttribute('aria-live');
        widgetElement.setAttribute('aria-busy', 'false');
    }

    function showError(widgetElement, language, errorType) {
        widgetElement.innerHTML = generateErrorPlaceholderHTML(language, errorType);
        widgetElement.setAttribute('aria-busy', 'false');
        widgetElement.classList.remove('amw-widget-pending');
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

    // The image is shown at 160 CSS pixels at most (--amw-img-size)
    const IMAGE_SIZE = 200;
    const MAX_TITLE_LENGTH = 150;

    /**
     * The same Amazon image at another size: its name carries the size (._SL500_.jpg), and Amazon
     * serves any of them. 500 pixels for a 160-pixel image weighs about three times too much.
     */
    function amazonImageOfSize(url, size) {
        try {
            const parsed = new URL(url);
            if (!/(^|\.)media-amazon\.com$/.test(parsed.hostname) && !/(^|\.)ssl-images-amazon\.com$/.test(parsed.hostname)) {
                return url;
            }
            parsed.pathname = parsed.pathname.replace(/\._SL\d+_\./, `._SL${size}_.`);
            return parsed.href;
        } catch (e) {
            return url;
        }
    }

    /** At most `max` characters, cut after a whole word. */
    function shortenOnWord(text, max) {
        if (text.length <= max) {
            return text;
        }
        const cut = text.slice(0, max - 1);
        const space = cut.lastIndexOf(' ');
        return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.\-–|]+$/, '')}…`;
    }

    /**
     * The Amazon link with the tracking ID the portal set for this site (AMW_PARTNER_TAGS), so
     * that the purchases of each site are credited to it. The answers of the API stay the same
     * for every site, which lets browsers and CDNs share them.
     */
    function withSiteTag(url) {
        const tags = window.AMW_PARTNER_TAGS;
        if (!tags || typeof tags !== 'object' || !Object.prototype.hasOwnProperty.call(tags, window.location.host)) {
            return url;
        }
        try {
            const parsed = new URL(url);
            // Only Amazon links carry a tracking ID
            if (!/(^|\.)amazon\.[a-z]{2,3}(\.[a-z]{2})?$/.test(parsed.hostname)) {
                return url;
            }
            parsed.searchParams.set('tag', String(tags[window.location.host]));
            return parsed.href;
        } catch (e) {
            return url;
        }
    }

    // Whether a card of the page shows the disclosure, for disclosureOnce
    let disclosureShown = false;

    /** Removes the disclosure of a card, and the link's description that pointed to it. */
    function dropDisclosure(widgetElement, disclosure) {
        const link = widgetElement.querySelector('.amw-widget-main-link');
        if (link && disclosure.id) {
            const described = (link.getAttribute('aria-describedby') || '').split(' ').filter(id => id && id !== disclosure.id);
            if (described.length > 0) {
                link.setAttribute('aria-describedby', described.join(' '));
            } else {
                link.removeAttribute('aria-describedby');
            }
        }
        disclosure.remove();
    }

    /**
     * Updates widget elements with product data
     */
    /**
     * A banner of the site, outside Amazon: its title, image and link, with none of the Amazon
     * marks (price, date, disclosure, #Amazon ribbon), no structured data and no beacon, which
     * count Amazon products.
     */
    function updateWidgetWithBanner(banner, widgetElement, language) {
        const lang = getStrings(language);
        const img = widgetElement.querySelector('.amw-widget-img');
        const image = safeUrl(banner.image, '');
        img.src = image;
        img.onerror = function() { this.style.display = 'none'; };
        widgetElement.querySelector('.amw-widget-caption').textContent = shortenOnWord(String(banner.title || ''), MAX_TITLE_LENGTH);
        const mainLink = widgetElement.querySelector('.amw-widget-main-link');
        mainLink.href = safeUrl(banner.url, '#');
        // The site's own link: not sponsored, and its description goes with the removed date
        mainLink.setAttribute('rel', 'noopener');
        mainLink.removeAttribute('aria-describedby');
        ['.amw-widget-price', '.amw-widget-text', '.amw-widget-banner'].forEach(selector => {
            const element = widgetElement.querySelector(selector);
            if (element) element.remove();
        });
        const hidden = widgetElement.querySelector('.amw-widget-body > .amw-widget-visually-hidden');
        if (hidden) hidden.textContent = `(${lang.new_tab})`;
        const button = widgetElement.querySelector('.amw-widget-btn-warning');
        if (button) button.textContent = typeof banner.label === 'string' && banner.label ? banner.label : (lang.learn_more || lang.buy);
        widgetElement.classList.add('amw-widget-custom');

        widgetElement.querySelector('.amw-widget-spinner').style.display = 'none';
        img.style.display = image ? 'block' : 'none';
        widgetElement.querySelector('.amw-widget-content').style.display = 'block';
        widgetElement.querySelector('.amw-widget-body').style.display = 'block';
        widgetElement.setAttribute('aria-busy', 'false');
        widgetElement.classList.remove('amw-widget-pending');
        if (activeEffect && activeEffect !== 'none') {
            widgetElement.classList.add(`amw-effect-${activeEffect}`);
        }
    }

    function updateWidgetWithData(product, widgetElement, language) {
        if (product && product.custom === true) {
            updateWidgetWithBanner(product, widgetElement, language);
            return;
        }
        // A copy: the cached product serves the other cards of the page too
        product = Object.assign({}, product, { url: product.url && withSiteTag(product.url) });
        const lang = getStrings(language);
        
        const img = widgetElement.querySelector('.amw-widget-img');
        const caption = widgetElement.querySelector('.amw-widget-caption');
        const price = widgetElement.querySelector('.amw-widget-price');
        const timestamp = widgetElement.querySelector('.amw-widget-timestamp');
        const links = widgetElement.querySelectorAll('.amw-widget-link');
        const spinner = widgetElement.querySelector('.amw-widget-spinner');
        const content = widgetElement.querySelector('.amw-widget-content');
        const body = widgetElement.querySelector('.amw-widget-body');

        const image = safeUrl(product.image, '');
        img.src = amazonImageOfSize(image, IMAGE_SIZE);
        // Screens with dense pixels get the sharper copy; without a size in its name, the image as is
        const sharper = amazonImageOfSize(image, IMAGE_SIZE * 2);
        if (sharper !== img.src) {
            img.srcset = `${sharper} 2x`;
        }
        img.onerror = function() { this.style.display = 'none'; };
        
        // The stylesheet shows two lines at most; this only bounds what a browser without line
        // clamping would show, on a whole word
        caption.textContent = shortenOnWord(product.title || lang.default_title, MAX_TITLE_LENGTH);
        
        const mainLink = widgetElement.querySelector('.amw-widget-main-link');
        if (mainLink) {
            mainLink.href = safeUrl(product.url, '#');
            const productId = displayedProductId(product, widgetElement);
            mainLink.addEventListener('click', function() { sendClickBeacon(productId); });
            // auxclick covers the middle click that opens the link in a new tab
            mainLink.addEventListener('auxclick', function(event) {
                if (event.button === 1) sendClickBeacon(productId);
            });
        }
        
        timestamp.textContent = lang.price_disclaimer.replace('{date}', formatDate(product.timestamp, widgetElement.getAttribute('data-locale') || language));

        // textContent: a custom disclosure comes from the page and must not inject markup
        const disclosure = widgetElement.querySelector('.amw-widget-disclosure');
        // The first card displayed rather than the first of the page: cards load lazily, and a
        // visitor landing mid-page must still see the disclosure on the first card in view
        if (disclosure && WIDGET_CONFIG.disclosureOnce && disclosureShown) {
            dropDisclosure(widgetElement, disclosure);
        } else if (disclosure) {
            disclosure.textContent = typeof WIDGET_CONFIG.disclosure === 'string' ? WIDGET_CONFIG.disclosure : lang.disclosure;
            disclosureShown = true;
        }

        // Low-commitment calls to action draw the most clicks; without a price to show, the price
        // itself is what the reader goes to see. Translations set before buy_no_price keep buy.
        const buy = widgetElement.querySelector('.amw-widget-btn-warning');
        if (product.price === -1) {
            price.textContent = lang.not_available;
            if (buy) buy.textContent = lang.buy_no_price || lang.buy;
        } else {
            price.textContent = product.price;
            if (buy) buy.textContent = buttonLabel(lang);
        }

        // innerHTML is safe here: price is escaped and savings coerced to a number
        const savings = Number(product.savings);
        if (savings > 0) {
            price.innerHTML = sanitizeText(product.price) + ` <span class="amw-widget-badge">-${savings}%<span class="amw-widget-visually-hidden"> ${sanitizeText(lang.savings)}</span></span>`;
        }
        // A flash sale ends within hours while the card may be cached longer: checked on display
        const dealEnd = typeof product.dealEnd === 'string' ? Date.parse(product.dealEnd) : NaN;
        if (product.price !== -1 && dealEnd > Date.now()) {
            const flash = document.createElement('span');
            flash.className = 'amw-widget-badge amw-widget-badge-flash';
            // A language added by setTranslations() may lack the label
            flash.textContent = lang.flash_sale || WIDGET_CONFIG.languages[DEFAULT_LANGUAGE].flash_sale;
            price.append(' ', flash);
        }

        // Only crawlers read the JSON-LD, so it must not delay showing the card
        runWhenIdle(function() { injectJsonLd(product); });

        spinner.style.display = 'none';
        // A product can come without an image: an empty src would show a broken one
        img.style.display = product.image ? 'block' : 'none';
        content.style.display = 'block';
        body.style.display = 'block';
        widgetElement.setAttribute('aria-busy', 'false');
        widgetElement.classList.remove('amw-widget-pending');
        if (activeEffect && activeEffect !== 'none') {
            widgetElement.classList.add(`amw-effect-${activeEffect}`);
        }

        recordView(displayedProductId(product, widgetElement));
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
    function applyTheme(element) {
        if (WIDGET_CONFIG.theme === 'default') {
            element.removeAttribute('data-amw-theme');
        } else {
            // setApiConfig can change the theme after the first stylesheets were loaded
            injectThemeCSS(WIDGET_CONFIG.theme);
            element.setAttribute('data-amw-theme', WIDGET_CONFIG.theme);
        }
    }

    function loadActualWidget(element, productId, language) {
        renderCard(element, language);
        element.className = 'amw-widget amw-widget-pending';
        
        loadProductData(productId, element, language);
    }

    /**
     * Transforms a div element into a lazy-loaded widget
     */
    function transformToLazyWidget(element) {
        // Without an id, the server chooses the product suited to the page
        const productId = element.id;

        const { language, locale } = resolveLanguage(element);

        // Read back by the IntersectionObserver callback (and data-locale by the rendering)
        element.setAttribute('data-product-id', productId);
        element.setAttribute('data-language', language);
        element.setAttribute('data-locale', locale);

        applyTheme(element);
        // Invisible until its product arrives, in the height it will take (no layout shift)
        element.className = 'amw-widget amw-widget-lazy amw-widget-pending';
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
        // Without an id, the server chooses the product suited to the page
        const productId = element.id;

        const { language, locale } = resolveLanguage(element);
        applyTheme(element);

        element.setAttribute('data-locale', locale);
        element.className = 'amw-widget amw-widget-pending';
        renderCard(element, language);

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
            debugLog(`Initialized ${amwElements.length} widgets with lazy loading`);
        } else {
            amwElements.forEach(transformToWidget);
            debugLog(`Initialized ${amwElements.length} widgets with immediate loading`);
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
    /** The cards an article of this site should hold: its own number when the portal set one. */
    function stuffedCardsOfSite(stuffing) {
        const sites = stuffing.sites;
        if (sites && typeof sites === 'object' && Object.prototype.hasOwnProperty.call(sites, window.location.host)) {
            return Number(sites[window.location.host]) || 0;
        }
        return Number(stuffing.count) || 0;
    }

    /** Per text node: textContent would join the last word of a paragraph with the next heading. */
    function countWords(element) {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let words = 0;
        while (walker.nextNode()) {
            const parent = walker.currentNode.parentNode;
            // Code of embedded scripts and styles is not text a reader sees
            if (parent && (parent.nodeName === 'SCRIPT' || parent.nodeName === 'STYLE')) {
                continue;
            }
            words += walker.currentNode.nodeValue.split(/\s+/).filter(Boolean).length;
        }
        return words;
    }

    /**
     * One card per Stuffing.wordsPerCard words of the article at most. The text of cards already
     * rendered (a second initialization) is not the article's.
     */
    function cardsAllowedByLength(container, placed, wordsPerCard) {
        const ratio = Number(wordsPerCard) || 0;
        if (ratio <= 0) {
            return Infinity;
        }
        const words = placed.reduce((total, card) => total - countWords(card), countWords(container));
        return Math.floor(words / ratio);
    }

    /**
     * Adds the cards asked for by the server (Stuffing.count, or the number of the site) to the
     * article: at the end of a paragraph, before a heading, spread evenly over the places
     * available. The number is a maximum and a total: a short article (Stuffing.wordsPerCard)
     * gets fewer, and the cards the author already placed in the article count. Each card takes
     * the next product recommended for the page.
     */
    function stuffWidgets() {
        const stuffing = window.AMW_STUFFING;
        const total = stuffing ? stuffedCardsOfSite(stuffing) : 0;
        const container = total > 0 && document.getElementById(stuffing.containerId);
        // Already there when the script is initialized again
        if (!container || container.querySelector('[data-amw-slot]')) {
            return;
        }
        // Before or after their transformation, which keeps their id
        const placed = Array.from(container.querySelectorAll('.amw, .amw-widget'));
        // A card without an id shows the first product of the page: stuffed cards take the next ranks
        const firstSlot = placed.filter(card => !card.id).length;
        const places = Array.from(container.querySelectorAll('h2, h3')).filter(heading => {
            const previous = heading.previousElementSibling;
            // After a paragraph only, and never against a card the author placed there
            return previous && previous.tagName === 'P' && !(heading.nextElementSibling &&
                heading.nextElementSibling.classList.contains('amw'));
        });
        const count = Math.min(total, cardsAllowedByLength(container, placed, stuffing.wordsPerCard)) - placed.length;
        if (count <= 0) {
            return;
        }
        const spots = Math.min(count, places.length);
        for (let index = 0; index < spots; index++) {
            const heading = places[Math.floor(index * places.length / spots)];
            const card = document.createElement('div');
            card.className = 'amw';
            card.setAttribute('data-amw-slot', String(firstSlot + index));
            heading.parentNode.insertBefore(card, heading);
        }
    }

    function init() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function() {
                stuffWidgets();
                initializeWidgets();
                setupMutationObserver();
            });
        } else {
            stuffWidgets();
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
            flushViews();
            document.removeEventListener('visibilitychange', flushViewsWhenHidden);
            window.removeEventListener('pagehide', flushViews);
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
            if (config.disclosure !== undefined) {
                WIDGET_CONFIG.disclosure = parseDisclosure(config.disclosure);
            }
            if (config.disclosureOnce !== undefined) {
                WIDGET_CONFIG.disclosureOnce = parseFlag(config.disclosureOnce);
            }
            if (config.template !== undefined) {
                // Widgets rendered afterwards use it
                WIDGET_CONFIG.template = parseTemplate(config.template) || WIDGET_CONFIG.template;
            }
            if (config.theme !== undefined) {
                // Widgets rendered afterwards use it
                WIDGET_CONFIG.theme = parseTheme(config.theme) || WIDGET_CONFIG.theme;
            }
            if (typeof config.debug === 'boolean') {
                debugEnabled = config.debug;
            }
            if (config.maxConcurrentRequests !== undefined) {
                WIDGET_CONFIG.performance.maxConcurrentRequests = config.maxConcurrentRequests;
                runQueuedRequests();
            }
        },
        /**
         * Adds a language or overrides labels of an existing one, e.g.
         * setTranslations('pl', { buy: 'Zobacz na Amazon', ... }). Missing labels of a new
         * language come from English. Widgets rendered afterwards use it.
         */
        setTranslations: function(language, strings) {
            const key = typeof language === 'string' ? language.trim().toLowerCase().replace(/_/g, '-') : '';
            if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(key) || !strings || typeof strings !== 'object') {
                console.warn('AMW: invalid translations ignored', language);
                return;
            }
            const merged = Object.assign({}, getStrings(key));
            Object.keys(merged).forEach(name => {
                if (typeof strings[name] === 'string') {
                    merged[name] = strings[name];
                }
            });
            // A page that names its own button keeps it on every card, with or without an offer,
            // whatever label the portal chose
            if (typeof strings.buy === 'string') {
                merged.custom_buy = true;
                if (typeof strings.buy_no_price !== 'string') merged.buy_no_price = strings.buy;
            }
            WIDGET_CONFIG.languages[key] = merged;
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
