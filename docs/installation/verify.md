# Verify the installation

Run these checks from the AMW host first, then through your blog's domain.

## 1. Health check

```bash
curl http://localhost:9080/item/health                 # on the AMW host (Docker defaults)
curl https://blog.example.com/item/health              # through the reverse proxy
```

Expected answer (HTTP 200):

```json
{"status":"ok","version":"5.0.0","timestamp":"2026-10-20T12:00:00.000Z","uptime":42.1,"redis":"connected"}
```

| `redis` | Meaning |
|---|---|
| `connected` | Redis is enabled and reachable. |
| `disabled` | Redis is not enabled (`REDIS_ENABLED`, `Redis.enabled`). Fine for a test, slower and costlier in API quota in production. |
| `disconnected` | Redis is enabled but the connection was lost; AMW keeps answering by calling Amazon directly. |

With Docker, `docker ps` also shows the container as `healthy` once the built-in health
check passes.

## 2. A real product

Pick the ASIN of a product from your marketplace (the 10 characters after `/dp/` in its
URL):

```bash
curl "https://blog.example.com/item/product?id=B084DN3XVN"
```

A JSON document with `title`, `image`, `price` and a `url` containing your partner tag
(`tag=yourtag-21`) means the credentials work. A `502` points to a credential or
network problem, a `404` to an ASIN that is not available on your marketplace: see
[Troubleshooting](troubleshooting.md#product-answers-an-error-for-every-product).

## 3. The widget

```bash
curl -I https://blog.example.com/item/widget.js     # 200, application/javascript
```

Then add a test card to a draft article:

```html
<div class="amw" id="B084DN3XVN"></div>
<script src="/item/widget.js" defer></script>
```

Open the draft: the card should look like the [product cards](../user-guide/widget.md)
of the user guide.

## 4. Optional: Swagger UI

If you enabled it (`SERVER_SWAGGER=true`), open `https://blog.example.com/item/docs/` to
explore the API interactively.
