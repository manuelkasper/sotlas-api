const MongoClient = require('mongodb').MongoClient;
const config = require('./config');
const assert = require('assert');

let db = null
let client
const connectPromise = new Promise((resolve, reject) => {
  client = new MongoClient(config.mongodb.url, {useUnifiedTopology: true})
  client.connect(function (err) {
    assert.equal(null, err)
    db = client.db(config.mongodb.dbName)
    resolve()
  });
});

exports.getDb = function() {
	return db
}

exports.waitDb = function(callback) {
  connectPromise.then(callback)
}

exports.closeDb = function() {
  if (client) {
    client.close()
  }
}
