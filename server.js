/**
 * Main API server in Express JS for AMW.
 * 
 * @author : ltoinel@free.Fr
 */

// Set a default environment by default
process.env.NODE_ENV = process.env.NODE_ENV || 'production'

// Loading libraries
const express = require('express');
const config = require('config');
const path = require('path');
const paapi = require('./paapi');

// Cache server for Express API.
const cacheEnabled = config.get('Redis.enabled');

if (cacheEnabled) {
  var cache = require('express-redis-cache')({
    host: config.get('Redis.host'),
    port: config.get('Redis.port'),
    auth_pass: config.get('Redis.password'),
    expire: config.get('Redis.expire')
  });
}

// Start the Express
const app = express();

// Returns a product description in JSON.
app.get('/product', (req, res) => {

  // If the cache is enabled we use it
  if (cacheEnabled) cache.route();

  var id = req.query.id;
  paapi.getItemApi(id, function (product, err) {
    res.json(product);
  });
});

// Returns a product HTML Card.
app.get('/card', (req, res) => {
  res.sendFile(path.join(__dirname + '/html/card.html'));
});

// Listen on the defined port, 8080 by default.
const PORT = config.get('Server.port');
app.listen(PORT, () => {
  console.log(`Paapi Gateway is listening on port ${PORT}...`);
});