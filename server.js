const express = require('express');
const config = require('config');
const paapi = require('./paapi');

const app = express();

// Return a product description
app.get('/product', (req, res) => {

  var id = req.query.id;
  var product =  paapi.getItemsApi(id);
  res.header("Content-Type",'application/json');
  console.log(JSON.stringify(product));
  res.send(JSON.stringify(product, null, 4));
});

// Listen to the App Engine-specified port, or 8080 otherwise
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}...`);
});