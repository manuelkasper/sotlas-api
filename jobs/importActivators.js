const axios = require('axios');
const MongoClient = require('mongodb').MongoClient;
const config = require('../config');
const assert = require('assert');
const htmlparser = require('htmlparser2');

const client = new MongoClient(config.mongodb.url, {useUnifiedTopology: true});
client.connect(err => {
	assert.equal(null, err);
	
	importActivators(client.db(config.mongodb.dbName));
});

async function importActivators(db) {
	let response = await axios.get('https://api-db2.sota.org.uk/rolls/activator/-1/0/all/all')

	// Weed out duplicate callsigns, keeping only the record with the higher number of points
	let activators = new Map();
	response.data.forEach(record => {
		let callsign = record.Callsign.toUpperCase().trim().replace('/P', '');
		let existingActivator = activators.get(callsign);
		if (existingActivator === undefined || existingActivator.Points < record.Points) {
			activators.set(callsign, record);
		}
	});

	let lastUpdate = new Date();
	let bulkWrites = [];
	for (let record of activators.values()) {
		let activator = {
			callsign: record.Callsign.toUpperCase().trim().replace('/P', ''),
			username: record.Username,
			userId: record.UserID,
			summits: record.Summits,
			points: record.Points,
			bonusPoints: record.BonusPoints,
			score: record.totalPoints,
			avgPoints: parseFloat(record.Average),
			lastUpdate
		};

		bulkWrites.push({updateOne: {
			filter: {callsign: activator.callsign},
			update: { $set: activator},
			upsert: true
		}});

		if (bulkWrites.length >= config.mongodb.batchSize) {
			await db.collection('activators').bulkWrite(bulkWrites);
			bulkWrites = [];
		}
	}

	if (bulkWrites.length > 0) {
		await db.collection('activators').bulkWrite(bulkWrites);
	}

	await db.collection('activators').deleteMany({lastUpdate: {$lt: lastUpdate}});

	await client.close();
}
