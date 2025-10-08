## Deployment and Usage

### Installation

```bash
npm install
npm start
```

### Deployment with PM2

```bash
sudo npm install pm2 -g
npm run build
pm2 start dist/src/main.js --name "amw"
pm2 startup
pm2 save
```

### NGINX Reverse Proxy Configuration

```nginx
location ^~ /amazon {
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_pass http://127.0.0.1:8080;
    proxy_read_timeout 600;
}
```

