# AMW - Amazon Modern Widgets

The default Amazon Widgets provided by Amazon to there partners are ugly and need some improvments in terms of user experience.
The goal of this project is to provide Amazing Amazon Widgets for your website with modern UX/UI.

The AMW project provides : 
- RestFull APIs to simplify the Amazon PAAPI 5 integration for Websites.
- A collection of product widgets with aysnc data loading and bootstrap integration.



## Start the project

Configure the "config/production.yml" based on "config/default.yml" file with your Amazon Partner information and then :

```console
$ npm install
$ npm start
```

If you want to keep AMW up, you can use PM2  :

```console
$ sudo npm install pm2 -g
$ pm2 start server.js
$ pm2 startup
... Run the command displayed by pm2.
$ pm2 save
```

## Expose the AMW services to your website

Create a reverse proxy to the NodeJS daemon : 

```
location ^~ /amazon {
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_pass  http://127.0.0.1:8080;
    proxy_read_timeout 600;
}
```

## Integrate the widget to your Website

Integrate a product widget to your Website : 

```html
<iframe src="/amazon/card?id=B0192CTN72" />
```

![](doc/resources//amazon-product-card.png)


## List of the API available

Generate an HTML card for an Amazon product : 
http://localhost:8080/card?id=B0192CTN72

Return JSON a description for an Amazon product : 
http://localhost:8080/product?id=B0192CTN72