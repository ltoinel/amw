![](doc/resources/amw-logo.png)

![](https://img.shields.io/github/issues/ltoinel/amw) ![](https://img.shields.io/github/license/ltoinel/amw) ![](https://img.shields.io/github/package-json/v/ltoinel/amw) ![Tests](https://img.shields.io/badge/tests-100%20passed-brightgreen) ![Test Suites](https://img.shields.io/badge/test%20suites-7%20passed-brightgreen)

## 📚 Documentation & Testing

- **[📖 Complete Functional Documentation](spec/)** - Comprehensive project specifications and architecture
- **[🧪 Unit Tests Documentation](spec/09-unit-tests-documentation.md)** - Detailed Jest test suite documentation  
- **✅ Test Coverage:** 100 tests passed across 7 test suites (~5s execution)
- **🔧 Updated Endpoints:** All APIs now available under `/amw` prefix

---

The standard Amazon Widgets provided by Amazon to its partners are not optimised and need some improvements in terms of user experience.
The goal of AMW is to provide Amazing Amazon Widgets for your website with attractive and modern UX/UI.

## ✨ Features & Improvements (v3.0.0)

The AMW project provides : 
- **RESTful APIs** to simplify Amazon PAAPI 5 integration for websites
- **Modern JavaScript Widget** with responsive design and async data loading
- **Dual Integration Methods** - Modern widget.js or traditional iframe support
- **Bootstrap 5 Integration** with customizable themes and responsive design
- **Comprehensive Test Coverage** with 100 Jest unit tests ensuring reliability
- **Updated API Endpoints** now available under `/amw` prefix for better branding
- **Enhanced Documentation** with detailed specifications and testing guides
- **TypeScript Support** for improved development experience and type safety
- **Redis Caching** for optimal performance and API quota management

The goal of AMW is to provide an alternative, simple and modern solution to integrate Amazon product descriptions into your website.
AMW can be integrated with all CMS: Ghost, Joomla, Dotclear, Drupal, Wordpress ...

## Start the AMW server

Configure the "config/production.yml" file with your Amazon partner information and then :

```bash
$ npm install
$ npm start
```

If you want to keep AMW up and running, you can use PM2 to manage the lifecycle of AMW:

```bash
sudo npm install pm2 -g
$ pm2 start dist/src/main.js
$ pm2 startup
... Execute the command displayed by pm2.
$ pm2 save
```


## Exposing the AMW services to your website

If you are using NGINX as your web server, you can easily create a reverse proxy to the NodeJS daemon.
In the example below, the AMW APIs will be available under the "/amw" path on your website.

```
location ^~ /amw {
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_pass http://127.0.0.1:8080;
    proxy_read_timeout 600;
}
```

## Optimise AMW performance

The Amazon Product API is limited by quotas: 
* 1 request per second and a cumulative daily limit of 8640 requests per day for the first 30 days.
* 1 call for every 5 cents of revenue generated from shipped items.

To limit the number of calls to the Amazon API, two solutions can be set up: 
* You have a Redis instance and you enable the caching option in the AMW config file.
* You can use NGINX and configure a micro-caching strategy to keep the results of the AMW APIs in memory.
* You can also use a CDN to cache the product data and avoid multiple call to Amazon APIs.

## 🎯 Integrate AMW Widgets into Your Website

AMW offers **two integration methods** to suit different needs and technical requirements:

### 📱 Method 1: Modern JavaScript Widget (Recommended)

**Modern, responsive, and customizable** - Use the AMW JavaScript widget for the best user experience:

```html
<!-- Include the AMW widget script -->
<script src="https://your-server/amw/widget"></script>

<!-- Create widget containers with data attributes -->
<div class="amw-widget" data-id="B084DN3XVN"></div>
<div class="amw-widget" data-keyword="arduino"></div>

<!-- Initialize widgets -->
<script>
  AMW.init({
    server: 'https://your-server',
    theme: 'modern', // optional: 'classic', 'minimal'
    responsive: true
  });
</script>
```

**✅ Advantages:**
- **Responsive design** - Automatically adapts to screen size
- **Modern styling** - Bootstrap 5 integration with custom themes
- **Better performance** - Async loading and client-side caching
- **SEO friendly** - Content is indexed by search engines
- **Customizable** - Easy styling and theme options
- **Progressive enhancement** - Works with JavaScript disabled

### 🖼️ Method 2: Traditional iframe Integration

**Simple plug-and-play** - Use iframes for quick integration without JavaScript dependencies:

```html
<!-- Product by ID -->
<iframe src="https://your-server/amw/card?id=B084DN3XVN" 
        scrolling="no" frameborder="no" loading="lazy" 
        style="width:100%; height:300px;"></iframe>

<!-- Product by keyword -->
<iframe src="https://your-server/amw/card?keyword=arduino" 
        scrolling="no" frameborder="no" loading="lazy" 
        style="width:100%; height:300px;"></iframe>
```

**✅ Advantages:**
- **Simple integration** - No JavaScript knowledge required
- **Isolated styling** - Widget styles don't affect your site
- **Security** - Sandboxed content
- **CMS friendly** - Works in any content management system

**⚠️ Limitations:**
- Fixed sizing (requires manual height adjustment)
- Less responsive on mobile devices
- SEO content not indexed by search engines

### 🎯 Which Method Should You Choose?

| Use Case | Recommended Method | Why? |
|----------|-------------------|------|
| **Modern website with build process** | JavaScript Widget | Better performance, SEO, responsive design |
| **E-commerce/Product pages** | JavaScript Widget | Better user experience and conversion rates |
| **Blog/Content sites** | JavaScript Widget | SEO benefits and responsive design |
| **Quick prototyping** | iframe | Faster implementation, no setup required |
| **Legacy CMS (older versions)** | iframe | Better compatibility with older systems |
| **Email newsletters** | iframe | JavaScript not supported in most email clients |

## Example of AMW integration

![](doc/resources//amazon-modern-widget.png)


## 🔌 AMW API Endpoints

AMW provides multiple endpoints to support both integration methods:

### Widget Resources
* **JavaScript Widget:** `GET /amw/widget` - Modern widget script for client-side integration
* **HTML Cards:** `GET /amw/card?id={ASIN}` or `GET /amw/card?keyword={term}` - Complete HTML for iframe integration

### Data APIs  
* **Product Data (JSON):** `GET /amw/product?id={ASIN}` or `GET /amw/product?keyword={term}` - Raw product data for custom implementations

### Examples
```bash
# Modern widget JavaScript
curl https://localhost:8080/amw/widget

# HTML card for iframe
curl "https://localhost:8080/amw/card?id=B0192CTN72"
curl "https://localhost:8080/amw/card?keyword=arduino"

# JSON product data
curl "https://localhost:8080/amw/product?id=B0192CTN72"
curl "https://localhost:8080/amw/product?keyword=arduino"
```

## 🛠️ Development & Testing

The project includes comprehensive testing and documentation:

```bash
# Run all tests
npm test

# Run tests with verbose output  
npm test -- --verbose

# Run tests in watch mode
npm test -- --watch
```

**Test Results:**
- ✅ 100 tests passed (100% success rate)
- ✅ 7 test suites covering all major components
- ✅ ~5 seconds execution time
- ✅ Full coverage of business logic, API endpoints, and edge cases

## 📋 Project Structure

```
amw/
├── spec/                    # 📚 Complete functional documentation
├── tests/                   # 🧪 Jest unit test suite  
├── src/                     # 💻 TypeScript source code
├── resources/               # 🎨 HTML templates and widgets
└── config/                  # ⚙️ Configuration files
```

## 🔗 More Information

* **[📖 Functional Documentation](spec/)** - Complete project specifications
* **[🧪 Testing Documentation](spec/09-unit-tests-documentation.md)** - Jest test suite details
* **[🌐 Amazon Affiliate Guide](https://www.geeek.org/amazon-affiliation-modern-widgets/)** - Integration tutorial
* **[💬 Contact](mailto:ludovic@toinel.com)** - Share your blog posts and feedback

## 📄 License

© Ludovic Toinel, 2025

Released under the MIT License