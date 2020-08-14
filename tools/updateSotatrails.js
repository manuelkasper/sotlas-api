const axios = require('axios');
const MongoClient = require('mongodb').MongoClient;
const config = require('../config');
const assert = require('assert');

const client = new MongoClient(config.mongodb.url, {useUnifiedTopology: true});
client.connect(function (err) {
	assert.equal(null, err);
	
	updateSotatrails(client.db(config.mongodb.dbName));
});

function updateSotatrails(db) {	
	axios.get(config.sotatrailsUrl)
		.then(response => {
			let bulkWrites = [];
			response.data.forEach(report => {
				let summitCode = report.association + '/' + report.region + '-' + report.code;
				bulkWrites.push({updateOne: {
					filter: {code: summitCode},
					update: { $set: {
						'resources.sotatrails': {
							url: report.url,
							details: report.details === 'true'
						}
					}},
					upsert: false
				}});
			});

			db.collection('summits').bulkWrite(bulkWrites, (err, r) => {
				if (err)
					console.error(err);
				client.close();
			});
		})
		.catch(error => {
			console.error(error);
			client.close();
		})
}
