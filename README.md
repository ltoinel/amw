![](doc/resources/amw-logo.png)

![](https://img.shields.io/github/issues/ltoinel/amw) ![](https://img.shields.io/github/license/ltoinel/amw) ![](https://img.shields.io/github/package-json/v/ltoinel/amw) ![Tests](https://img.shields.io/badge/tests-100%20passed-brightgreen) ![Test Suites](https://img.shields.io/badge/test%20suites-7%20passed-brightgreen)

## 📚 Documentation & Testing

- **[📖 Complete Project Documentation](spec/)** - All comprehensive documentation is organized in the `/spec` directory
- **[🎯 Project Enhancement Summary](spec/00-project-enhancement-summary.md)** - Complete v3.0.0 transformation overview
- **[🧪 Unit Tests Documentation](spec/09-unit-tests-documentation.md)** - Detailed Jest test suite documentation
- **[🚀 CI/CD Pipeline Documentation](spec/11-ci-cd-documentation.md)** - GitHub Actions workflows and automation
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
- **Docker Support** with multi-container setup (AMW + Redis + Nginx)
- **Bootstrap 5 Integration** with customizable themes and responsive design
- **Comprehensive Test Coverage** with 100 Jest unit tests ensuring reliability
- **Updated API Endpoints** now available under `/amw` prefix for better branding
- **Enhanced Documentation** with detailed specifications and testing guides
- **TypeScript Support** for improved development experience and type safety
- **Redis Caching** for optimal performance and API quota management
- **CI/CD Automation** with comprehensive GitHub Actions workflows for testing, building, and deployment
- **Production Ready** with security best practices, monitoring, and automated deployment pipelines

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

## 🐳 Docker Deployment (Recommended)

AMW includes Docker support for easy deployment and scalability:

### Quick Start with Docker Compose

```bash
# Clone and configure
git clone https://github.com/ltoinel/amw.git
cd amw
cp config/sample.yml config/production.yml
# Edit config/production.yml with your Amazon credentials

# Build and start all services (AMW + Redis + Nginx)
docker-compose up -d

# Check services status
docker-compose ps

# View logs
docker-compose logs -f amw
```

### Docker Build Only

```bash
# Build the Docker image
docker build -t amw:latest .

# Run AMW container
docker run -d \
  --name amw-app \
  -p 8080:8080 \
  -v ./config/production.yml:/app/config/production.yml:ro \
  amw:latest

# Check container health
docker ps
```

### Production Deployment Features

- ✅ **Multi-stage build** for optimized image size (~150MB)
- ✅ **Non-root user** for enhanced security
- ✅ **Health checks** for container monitoring
- ✅ **Redis integration** for optimal caching
- ✅ **Nginx reverse proxy** for production setup
- ✅ **Volume mounting** for configuration and logs
- ✅ **Signal handling** with dumb-init

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

The project includes comprehensive development tools and scripts:

### 📋 Available NPM Scripts

#### Building & Development
```bash
# Build TypeScript to JavaScript
npm run build

# Build with file watching
npm run build:watch

# Clean build directory
npm run clean

# Development mode with ts-node
npm run dev

# Development with auto-reload
npm run dev:watch

# Start production server
npm start

# Start development server
npm run start:dev
```

#### Testing & Quality
```bash
# Run all tests
npm test

# Run tests with verbose output  
npm test -- --verbose

# Run tests in watch mode
npm run test:watch

# Run tests with coverage report
npm run test:coverage

# Run tests for CI (non-interactive)
npm run test:ci

# Lint TypeScript code
npm run lint

# Fix linting errors automatically
npm run lint:fix
```

#### Docker Operations
```bash
# Build Docker image
npm run docker:build

# Run Docker container
npm run docker:run

# Start Docker Compose stack
npm run docker:compose

# Stop Docker Compose stack
npm run docker:compose:down

# View Docker Compose logs
npm run docker:compose:logs
```

#### CI/CD & Release
```bash
# Run full CI check (lint + build + test)
npm run ci:check

# Create patch release (v1.0.1)
npm run release:patch

# Create minor release (v1.1.0)  
npm run release:minor

# Create major release (v2.0.0)
npm run release:major
```

### 🤖 GitHub Actions CI/CD

AMW includes comprehensive GitHub Actions workflows for automated testing, building, and deployment:

#### 🧪 Continuous Integration (`ci.yml`)
- **Triggers:** Push to `main`/`develop`, Pull requests
- **Node.js versions:** 18, 20 (matrix testing)
- **Steps:** Lint → Build → Test → Security audit → Docker build test
- **Features:**
  - ✅ Code coverage with Codecov integration
  - ✅ Security scanning with Snyk
  - ✅ Docker build validation
  - ✅ Quality gate enforcement

#### 🚀 Release & Deploy (`release.yml`)
- **Triggers:** Git tags (`v*.*.*`), Manual dispatch
- **Steps:** Build → Docker build/push → GitHub release → Deploy
- **Features:**
  - ✅ Multi-platform Docker images (amd64, arm64)
  - ✅ GitHub Container Registry (ghcr.io)
  - ✅ Automated changelog generation
  - ✅ Release artifacts with documentation

#### 🔄 Auto Deploy (`deploy.yml`) 
- **Triggers:** Push to `main` (production), `develop` (staging)
- **Environments:** Staging, Production with approval gates
- **Features:**
  - ✅ Environment-specific deployments
  - ✅ SSH deployment support
  - ✅ Health checks and rollback capabilities
  - ✅ Docker Compose orchestration

#### 🧹 Maintenance (`maintenance.yml`)
- **Triggers:** Weekly schedule (Mondays 3 AM UTC), Manual dispatch
- **Tasks:** Dependency updates, Security scans, Performance tests
- **Features:**
  - ✅ Automated dependency PRs
  - ✅ Container vulnerability scanning
  - ✅ Docker registry cleanup
  - ✅ Code quality reports

### 🔐 Required Secrets

For full CI/CD functionality, configure these GitHub secrets:

```bash
# Deployment
DEPLOY_HOST=your-server.com
DEPLOY_USER=amw-deploy
DEPLOY_KEY=-----BEGIN OPENSSH PRIVATE KEY-----...

# Security & Quality
CODECOV_TOKEN=your-codecov-token
CC_TEST_REPORTER_ID=your-code-climate-id
SNYK_TOKEN=your-snyk-token
```

**Test Results:**
- ✅ 100 tests passed (100% success rate)
- ✅ 7 test suites covering all major components
- ✅ ~5 seconds execution time
- ✅ Full coverage of business logic, API endpoints, and edge cases
- ✅ GitHub Actions CI/CD with automated deployment

## 📋 Project Structure

```
amw/
├── spec/                    # 📚 Complete functional documentation
├── tests/                   # 🧪 Jest unit test suite (100 tests)
├── src/                     # 💻 TypeScript source code
├── resources/               # 🎨 HTML templates and widgets
├── config/                  # ⚙️ Configuration files
├── Dockerfile               # 🐳 Docker container definition
├── docker-compose.yml       # 🐳 Multi-container setup (AMW + Redis + Nginx)
├── .dockerignore           # 🐳 Docker build optimization
└── nginx.conf              # 🌐 Production Nginx configuration
```

### 🐳 Docker Files

The project includes complete Docker support for production deployments:

- **`Dockerfile`** - Multi-stage build with security best practices
- **`docker-compose.yml`** - Complete stack with AMW, Redis, and Nginx
- **`.dockerignore`** - Optimized build context for smaller images
- **`nginx.conf`** - Production-ready reverse proxy with caching and rate limiting

## 🔗 More Information

* **[📖 Functional Documentation](spec/)** - Complete project specifications
* **[🧪 Testing Documentation](spec/09-unit-tests-documentation.md)** - Jest test suite details
* **[🌐 Amazon Affiliate Guide](https://www.geeek.org/amazon-affiliation-modern-widgets/)** - Integration tutorial
* **[💬 Contact](mailto:ludovic@toinel.com)** - Share your blog posts and feedback

## 📄 License

© Ludovic Toinel, 2025

Released under the MIT License