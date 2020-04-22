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

// Return a product description in JSON
app.get('/product', (req, res) => {

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