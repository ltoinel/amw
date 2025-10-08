## Performance Optimization

### Amazon PAAPI 5 Quotas
- **Initial period**: 1 request/second, max 8640 requests/day (first 30 days)
- **After 30 days**: 1 call for every 5 cents of generated revenue

### Optimization Strategies
1. **Redis Cache**: API response caching with configurable TTL
2. **HTTP Cache**: Cache headers for responses (configurable via `httpCache`)
3. **NGINX Micro-caching**: Reverse proxy level caching
4. **CDN**: CDN distribution to reduce load

### NGINX Micro-caching Configuration

```nginx
proxy_cache_path /tmp/nginx_cache levels=1:2 keys_zone=api_cache:10m 
                 max_size=100m inactive=60m use_temp_path=off;

location ^~ /amazon {
    proxy_cache api_cache;
    proxy_cache_valid 200 5m;
    proxy_cache_use_stale error timeout updating http_500 http_502 http_503 http_504;
    # ... other proxy directives
}
```