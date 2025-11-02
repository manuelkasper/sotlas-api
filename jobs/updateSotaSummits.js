const axios = require('axios');
const MongoClient = require('mongodb').MongoClient;
const config = require('../config');
const assert = require('assert');
const {parse} = require('csv-parse/sync');
const fs = require('fs');
const removeDiacritics = require('diacritics').remove;

const client = new MongoClient(config.mongodb.url);
client.connect(function (err) {
	assert.equal(null, err);
	
	processSummitList(client.db(config.mongodb.dbName));
});

async function processSummitList(db) {
	let associations = new Map();
	let now = new Date();

	let prefixToIsoCode = parse(fs.readFileSync(__dirname + '/isocodes.txt'));
	
	let response = await axios.get(config.summitListUrl);
	let body = response.data.substring(response.data.indexOf("\n")+1, response.data.length);

	let summits = parse(body, {columns: true, relax_column_count: true});
	let csvSummitCodes = new Set();
	
	if (summits.length < 100000) {
		console.error("Bad number of summits, expecting more than 100000");
		client.close();
		return;
	}

	let bulkWrites = [];
	for (let summit of summits) {
		summit.SummitCode = summit.SummitCode.trim().toUpperCase();
		summit.ValidFrom = dateToMongo(summit.ValidFrom);
		summit.ValidTo = dateToMongo(summit.ValidTo, true);
		if (summit.ActivationDate) {
			summit.ActivationDate = dateToMongo(summit.ActivationDate);
		} else {
			summit.ActivationDate = null;
			summit.ActivationCall = null;
		}
		csvSummitCodes.add(summit.SummitCode);

		bulkWrites.push({updateOne: {
			filter: {code: summit.SummitCode},
			update: { $set: {
				code: summit.SummitCode,
				name: summit.SummitName,
				nameNd: removeDiacritics(summit.SummitName),
				altitude: parseInt(summit.AltM),
				points: parseInt(summit.Points),
				bonusPoints: parseInt(summit.BonusPoints),
				coordinates: {
					longitude: Number(parseFloat(summit.Longitude).toFixed(5)),
					latitude: Number(parseFloat(summit.Latitude).toFixed(5))
				},
				validFrom: summit.ValidFrom,
				validTo: summit.ValidTo,
				activationCount: parseInt(summit.ActivationCount),
				activationCall: summit.ActivationCall,
				activationDate: summit.ActivationDate
			},
			$unset: {
				retired: ""
			}},
			upsert: true
		}});

		if (bulkWrites.length >= config.mongodb.batchSize) {
			await db.collection('summits').bulkWrite(bulkWrites);
			bulkWrites = [];
		}

		let SummitAssociation = getAssociation(summit.SummitCode);
		let SummitRegion = getRegion(summit.SummitCode);
		
		let isValid = (summit.ValidFrom <= now && summit.ValidTo >= now);
		let association = associations.get(SummitAssociation);
		if (!association) {
			let info = isoCodeForPrefix(SummitAssociation, prefixToIsoCode);
			if (!info) {
				continue;
			}
			association = {code: SummitAssociation, name: summit.AssociationName, isoCode: info.isoCode, continent: info.continent, regions: new Map(), summitCount: 0};
			associations.set(SummitAssociation, association);
		}
		let region = association.regions.get(SummitRegion);
		if (!region) {
			region = {code: SummitRegion, name: summit.RegionName, summitCount: 0};
			association.regions.set(SummitRegion, region);
		}
		if (isValid) {
			association.summitCount++;
			region.summitCount++;
		}

		let lat = parseFloat(summit.Latitude);
		let lon = parseFloat(summit.Longitude);

		if (!region.bounds) {
			region.bounds = [[lon, lat], [lon, lat]];
		} else {
			region.bounds[0][0] = Math.min(region.bounds[0][0], lon);
			region.bounds[0][1] = Math.min(region.bounds[0][1], lat);
			region.bounds[1][0] = Math.max(region.bounds[1][0], lon);
			region.bounds[1][1] = Math.max(region.bounds[1][1], lat);
		}

		if (!association.bounds) {
			association.bounds = [[lon, lat], [lon, lat]];
		} else {
			association.bounds[0][0] = Math.min(association.bounds[0][0], lon);
			association.bounds[0][1] = Math.min(association.bounds[0][1], lat);
			association.bounds[1][0] = Math.max(association.bounds[1][0], lon);
			association.bounds[1][1] = Math.max(association.bounds[1][1], lat);
		}
	}

	if (bulkWrites.length > 0) {
		await db.collection('summits').bulkWrite(bulkWrites);
	}

	// Fetch all non-retired summit codes in DB and find those that don't exist in the CSV anymore
	let dbSummitCodes = new Set(await db.collection('summits').distinct('code', {'retired': {$in: [null, false]}}));
	let retiredSummitCodes = new Set([...dbSummitCodes].filter(x => !csvSummitCodes.has(x)));

	// Mark those summits as retired in DB, and also warn if one of them has photos
	for (const code of retiredSummitCodes) {
		let summit = await db.collection('summits').findOne({code});
		if (summit.photos) {
			console.error(`[ALERT] Summit ${code} has been retired, but still has photos!`);
		}
		await db.collection('summits').updateOne({code}, {$set: {retired: true}});
	}

	// Update associations	
	for (let association of associations.values()) {
		association.regions = [...association.regions.values()];
	}
	
	let session = client.startSession();
	await session.withTransaction(async () => {
		let associationCollection = db.collection('associations');
		await associationCollection.deleteMany({}, { session });
		await associationCollection.insertMany([...associations.values()], { session });
	});
	session.endSession();
	client.close();
}

function dateToMongo(date, endOfDay = false) {
	let dateRegex = /^(\d\d)\/(\d\d)\/(\d\d\d\d)$/;
	let dateRegex2 = /^(\d\d\d\d)-(\d\d)-(\d\d)/;
	let matches = dateRegex.exec(date);
	let matches2 = dateRegex2.exec(date);
	if (matches) {
		if (endOfDay) {
			return new Date(Date.UTC(matches[3], matches[2]-1, matches[1], 23, 59, 59, 999));
		} else {
			return new Date(Date.UTC(matches[3], matches[2]-1, matches[1]));
		}
	} else if (matches2) {
		if (endOfDay) {
			return new Date(Date.UTC(matches2[1], matches2[2]-1, matches2[3], 23, 59, 59, 999));
		} else {
			return new Date(Date.UTC(matches2[1], matches2[2]-1, matches2[3]));
		}
	} else {
		throw Error("Bad date " + date);
	}
}

let summitRegex = /^(.+)\/(.+)-(\d+)$/;
function getAssociation(summitRef) {
	let matches = summitRegex.exec(summitRef);
	if (matches) {
		return matches[1];
	} else {
		throw Error("Bad summit ref '" + summitRef + "'");
	}
}

function getRegion(summitRef) {
	let matches = summitRegex.exec(summitRef);
	if (matches) {
		return matches[2];
	} else {
		throw Error("Bad summit ref '" + summitRef + "'");
	}
}

function isoCodeForPrefix(prefix, prefixToIsoCode) {
	let isoCodeEnt = prefixToIsoCode.find(el => {
		if (prefix.startsWith(el[0])) {
			return true;
		}
	});
	if (isoCodeEnt) {
		return {isoCode: isoCodeEnt[1], continent: isoCodeEnt[2]};
	} else {
		console.error(`[ALERT] ISO code not found for prefix ${prefix}`);
		return null;
	}
}
