const express = require('express');
const config = require('config');
const paapi = require('./paapi');
const app = express();

// Return a product description
app.get('/product', (req, res) => {

  var id = req.query.id;
  paapi.getItemApi(id, function (product,err){
      res.json(product);
  }); 
});

// Listen to the App Engine-specified port, or 8080 otherwise
const PORT = config.get('Server.port');
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}...`);
});