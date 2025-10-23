# Configuration

## Configuration File (config/production.yml)

```yaml
Amazon:
  accessKey: <YOUR ACCESS KEY>        # AWS access key
  secretKey: <YOUR SECRET KEY>        # AWS secret key
  host: webservices.amazon.fr         # Amazon regional host
  region: eu-west-1                   # AWS region
  partnerTag: <YOUR PARTNER TAG>      # Amazon partner tag
  partnerType: Associates             # Partnership type
  marketplace: www.amazon.fr          # Amazon marketplace
  condition: New                      # Product condition

Server:
  port: 8080                         # Server listening port
  debug: true                        # Debug mode
  path: /amw                      # APIs base path
  cors: false                        # CORS activation
  projectDir: <PATH_TO_PROJECT>      # Project directory
  httpCache: 3600                    # HTTP cache in seconds

Redis:
  enabled: false                     # Redis cache activation
  host: localhost                    # Redis host
  port: 6379                         # Redis port
  password:                          # Redis password (optional)
  username:                          # Redis username (optional)
  expire: 3600                       # Cache TTL in seconds
```