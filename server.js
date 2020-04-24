/**
 * Main API server in Express JS that return the Amazon Product information.
 * 
 * @author : ltoinel@free.Fr
 */

const express = require('express');
const config = require('config');
const path = require('path');
const paapi = require('./paapi');
const app = express();
const cacheEnabled = config.get('Redis.enabled');

// Cache server for Express API
if (cacheEnabled){
  var cache = require('express-redis-cache')({
    host: config.get('Redis.host'), 
    port: config.get('Redis.port'), 
    auth_pass: config.get('Redis.password'),
    expire: config.get('Redis.expire') 
  });
}

// Return a product description in JSON
app.get('/product', (req, res) => {

  // If the cache is enabled we use it
  if (cacheEnabled) cache.route();

  var id = req.query.id;
  paapi.getItemApi(id, function (product,err){
      res.json(product);
  }); 
});

// Return a product HTML Card
app.get('/card', (req, res) => {
  res.sendFile(path.join(__dirname+'/html/card.html'));
});

// Listen to the App Engine-specified port, or 8080 otherwise
const PORT = config.get('Server.port');
app.listen(PORT, () => {
  console.log(`Paapi Gateway is listening on port ${PORT}...`);
});