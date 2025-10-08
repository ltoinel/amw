## Technical Architecture

### Technology Stack
- **Backend**: Node.js with TypeScript
- **Web Framework**: Express.js
- **Amazon API**: PAAPI 5.0 via `@josecfreitas/paapi5-nodejs-sdk` SDK
- **Cache**: Redis (optional)
- **Frontend**: HTML/CSS/JavaScript
- **Logging**: typescript-logging with Log4j style

### Project Structure

```
amw/
├── src/
│   ├── main.ts                 # Application entry point
│   ├── server/
│   │   ├── AmwServer.ts        # Main Express server
│   │   ├── AmwApi.ts           # API endpoints implementation
│   │   └── Paapi.ts            # Wrapper for Amazon PAAPI 5 API
│   └── utils/
│       └── ConfigLog4j.ts      # Logging configuration
├── config/
│   ├── production.yml          # Production configuration
│   └── sample.yml              # Configuration example
├── resources/html/
│   ├── card.html               # Widget iframe template
│   └── widget.js               # Standalone JavaScript script
└── spec/                       # Documentation (this file)
```
