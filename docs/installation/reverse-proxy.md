# Reverse proxy

The widget fetches product data from **the same origin as the page**, under `/item`
(see [API location](../widget.md#api-location)). Expose AMW on your website by proxying
that path to the AMW server.

## NGINX

```nginx
location ^~ /item/ {
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_pass http://127.0.0.1:9080;   # 9080 for Docker, Server.port otherwise
    proxy_read_timeout 60s;
}
```

`proxy_pass` has no URI part, so the request path is forwarded unchanged: AMW must be
configured with `Server.path: /item` (the Docker default).

!!! important "Set `Server.trustProxy`"
    Behind a proxy, every request reaches AMW from the proxy's address. Set
    [`Server.trustProxy`](../configuration.md#server) to the number of proxies in front
    of AMW (`1` for a single NGINX, which is the Docker default) so that the client IP
    used by the rate limiter and the logs is read from `X-Forwarded-For`. Do not set it
    to `true` unless AMW is only reachable through trusted proxies: clients could then
    spoof their IP and bypass rate limiting.

## Micro-caching (optional)

AMW already sends `Cache-Control: max-age=<Server.httpCache>`. You can additionally
cache responses in NGINX to absorb traffic spikes without reaching AMW at all:

```nginx
proxy_cache_path /var/cache/nginx/amw levels=1:2 keys_zone=amw_cache:10m
                 max_size=100m inactive=60m use_temp_path=off;

location ^~ /item/ {
    proxy_cache amw_cache;
    proxy_cache_valid 200 10m;
    proxy_cache_use_stale error timeout updating http_500 http_502 http_503 http_504;
    # ... proxy_set_header / proxy_pass directives from above
}
```

A CDN in front of your site achieves the same result. See
[Performance & quotas](../performance.md).
