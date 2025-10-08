## Features

### 1. REST API for Amazon Products

#### Endpoint `/amazon/product`
- **Description**: Returns JSON data of an Amazon product
- **Methods**: GET
- **Parameters**:
  - `id`: Amazon product ID/ASIN
  - `keyword`: Keyword for product search
- **Example**:
  ```
  GET /amazon/product?id=B084DN3XVN
  GET /amazon/product?keyword=arduino
  ```

#### Endpoint `/amazon/card`
- **Description**: Returns a complete HTML page with product widget
- **Methods**: GET
- **Usage**: Integration via iframe
- **Example**:
  ```html
  <iframe src="https://your-server/amazon/card?id=B084DN3XVN" 
          scrolling="no" frameborder="no" loading="lazy" 
          style="width:100%"></iframe>
  ```

#### Endpoint `/amazon/widget`
- **Description**: Returns JavaScript script for standalone widgets
- **Methods**: GET
- **Usage**: Direct inclusion in HTML
- **Example**:
  ```html
  <script src="https://your-server/amazon/widget"></script>
  <div class="amazon" id="B084DN3XVN"></div>
  ```

### 2. Redis Cache System

The Redis cache system optimizes performance and respects Amazon API quotas:

- **Key-value cache**: Amazon API responses are cached with configurable TTL
- **API call reduction**: Avoids repetitive calls to Amazon PAAPI
- **Flexible configuration**: Cache can be disabled via configuration

### 3. Modernized Widgets

#### Iframe Widget (card.html)
- Responsive design with Bootstrap 5
- Modern visual effects (hover zoom, CSS animations)
- Multilingual support (French, Spanish, English)
- Displayed information:
  - Product image with zoom effect
  - Product title
  - Price and promotions
  - Amazon Prime eligibility
  - Buy/more info button

#### Standalone JavaScript Widget (widget.js)
- Self-executing script that transforms divs with class="amazon"
- Automatic CSS injection
- Asynchronous product data loading
- Error handling and loading states management
- Integrated multilingual configuration
