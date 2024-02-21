const express = require('express');
const config = require('./config');
const assert = require('assert');
const app = express();
const expressWs = require('express-ws')(app);
const cacheControl = require('express-cache-controller');
const bearerToken = require('express-bearer-token');
const wsManager = require('./ws-manager');
const SotaSpotReceiver = require('./sotaspots');
const RbnReceiver = require('./rbn');
const db = require('./db');
const alerts = require('./alerts');
const geoexport = require('./geoexport');
const users = require('./users');
const activations = require('./activations');
const utils = require('./utils');
const photos_router = require('./photos_router');
const solardata = require('./solardata');
const maxmind = require('maxmind');
const cronjobs = require('./cronjobs');
const moment = require('moment');

let geoLookup;
import('geolite2-redist').then((geolite2) => {
	return geolite2.open(
		'GeoLite2-City',
		(dbPath) => maxmind.open(dbPath)
	)
}).then((reader) => {
	geoLookup = reader;
});

let dbChecker = (req, res, next) => {
	if (db.getDb() == null) {
		console.error('DB error');
		res.status(500).end();
		return;
	}
	next();
};
app.enable('trust proxy');
app.use(express.json());
app.use(dbChecker);
app.use(cacheControl({
	maxAge: 3600
}));
app.use(bearerToken());
app.use('/ws', wsManager.router);
app.use('/alerts', alerts);
app.use('/geoexport', geoexport);
app.use('/activations', activations);
app.use('/users', users);
app.use('/photos', photos_router);
app.use('/solardata', solardata);

db.waitDb(() => {
	let sotaSpotReceiver = new SotaSpotReceiver();
	sotaSpotReceiver.start();
	let rbnReceiver = new RbnReceiver();
	rbnReceiver.start();
})

cronjobs();

app.get('/summits/search', (req, res) => {
	let limit = 100;
	if (req.query.limit) {
		let limitOverride = parseInt(req.query.limit);
		if (limitOverride > 0 && limitOverride < limit) {
			limit = limitOverride;
		}
	}
	db.getDb().collection('summits').find({
			$or: [{code: {'$regex': req.query.q, '$options': 'i'}}, {name: {'$regex': req.query.q, '$options': 'i'}}, {nameNd: {'$regex': req.query.q, '$options': 'i'}}],
			retired: {$in: [null, false]}
		}, {projection: {'_id': false, 'photos': false, 'routes': false, 'links': false, 'resources': false}}).limit(limit).toArray((err, summits) => {
		if (err) {
			console.error(err);
			res.status(500).end();
			return;
		}

		res.json(summits);
	});
});

app.get('/summits/near', (req, res) => {
	let limit = 100;
	if (req.query.limit) {
		let limitOverride = parseInt(req.query.limit);
		if (limitOverride > 0 && limitOverride < limit) {
			limit = limitOverride;
		}
	}
	let query = {
		coordinates: {$near: {$geometry: {type: "Point", coordinates: [parseFloat(req.query.lon), parseFloat(req.query.lat)]}}},
		retired: {$in: [null, false]}
	};
	if (req.query.maxDistance) {
		query.coordinates.$near.$maxDistance = parseFloat(req.query.maxDistance);
	}
	if (!req.query.inactive) {
		query.validFrom = {$lte: new Date()};
		query.validTo = {$gte: new Date()};
	}
	db.getDb().collection('summits').find(query, {projection: {'_id': false, 'photos': false, 'routes': false, 'links': false, 'resources': false}}).limit(limit).toArray((err, summits) => {
		if (err) {
			console.error(err);
			res.status(500).end();
			return;
		}

		res.json(summits);
	});
});

app.get('/summits/recent_photos/:associations/:days', (req, res) => {
	let limit = 100;
	let days = req.params.days;
	if (req.query.limit) {
		let limitOverride = parseInt(req.query.limit);
		if (limitOverride > 0 && limitOverride < limit) {
			limit = limitOverride;
		}
	}
	let query = {
		"photos.uploadDate": {$gte: new Date((new Date().getTime() - (days * 24 * 60 * 60 * 1000)))}
	}
	if (/^([A-Z0-9]{1,3}\|?)+$/.test(req.params.associations)) {
		query.code = {$regex: new RegExp("^(" + req.params.associations + ")/")};
	}
	db.getDb().collection('summits').find(query, {projection: {'_id': false, 'routes': false, 'links': false, 'resources': false}}).sort({"photos.uploadDate": -1}).limit(limit).toArray((err, summits) => {
		if (err) {
			console.error(err);
			res.status(500).end();
			return;
		}

		res.json(summits);
	});
});

app.get('/summits/:association/:code', (req, res) => {
	res.cacheControl = {
		noCache: true
	};
	
	db.getDb().collection('summits').findOne({code: req.params.association + '/' + req.params.code, retired: {$in: [null, false]}}, {projection: {'_id': false}}, (err, summit) => {
		if (err) {
			console.error(err);
			res.status(500).end();
			return;
		}

		if (!summit) {
			res.status(404).end();
			return;
		}

		let associationCode = summit.code.substring(0, summit.code.indexOf('/'));
		db.getDb().collection('associations').findOne({code: associationCode}, (err, association) => {
			if (association) {
				summit.isoCode = association.isoCode;
				summit.continent = association.continent;
			}
			res.json(summit);
		});
	});
});

// Dummy POST endpoint to help browser invalidate cache after uploading photos
app.post('/summits/:association/:code', (req, res) => {
	res.cacheControl = {
      noCache: true
    };

    res.status(204).end();
});

app.get('/associations/all', (req, res) => {
	db.getDb().collection('associations').find({}, {projection: {'_id': false}}).toArray((err, associations) => {
		if (err) {
			console.error(err);
			res.status(500).end();
			return;
		}

		res.json(associations);
	});
});

app.get('/associations/:association', (req, res) => {
	db.getDb().collection('associations').findOne({code: req.params.association}, {projection: {'_id': false}}, (err, association) => {
		if (err) {
			console.error(err);
			res.status(500).end();
			return;
		}

		if (!association) {
			res.status(404).end();
			return;
		}

		res.json(association);
	});
});

app.get('/regions/:association/:region', (req, res) => {
	let region = req.params.association + '/' + req.params.region;
	if (!region.match(/^[A-Z0-9]+\/[A-Z0-9]+$/)) {
		res.status(400).end();
		return;
	}
	db.getDb().collection('summits').find({code: {'$regex': '^' + region}, retired: {$in: [null, false]}}, {projection: {'_id': false, 'routes': false, 'links': false, 'resources': false}}).toArray((err, summits) => {
		if (err) {
			console.error(err);
			res.status(500).end();
			return;
		}

		summits.forEach(summit => {
			if (summit.photos && summit.photos.length > 0) {
				summit.hasPhotos = true;
			}
			delete summit.photos;
		});

		res.json(summits);
	});
});

app.get('/activators/search', (req, res) => {
	let skip = 0;
	if (req.query.skip) {
		skip = parseInt(req.query.skip);
	}
	let limit = 100;
	if (req.query.limit) {
		if (parseInt(req.query.limit) <= limit) {
			limit = parseInt(req.query.limit);
		}
	}
	let sortField = 'score';
	let sortDirection = -1;
	if (req.query.sort === 'callsign' || req.query.sort === 'points' || req.query.sort === 'bonusPoints' || req.query.sort === 'score' || req.query.sort === 'summits' || req.query.sort === 'avgPoints') {
		sortField = req.query.sort;
	}
	if (req.query.sortDirection == 'desc') {
		sortDirection = -1;
	} else {
		sortDirection = 1;
	}
	let sort = {};
	sort[sortField] = sortDirection;
	let query = {};
	if (req.query.q !== undefined && req.query.q !== '') {
		query = {callsign: {'$regex': req.query.q, '$options': 'i'}};
	}

	db.getDb().collection('activators').countDocuments(query, (err, count) => {
		if (err) {
			console.error(err);
			res.status(500).end();
			return;
		}
		let cursor = db.getDb().collection('activators').find(query, {projection: {'_id': false}}).sort(sort);

		cursor.skip(skip).limit(limit).toArray((err, activators) => {
			res.json({activators, total: count});
			cursor.close();
		});
	});
});

app.get('/activators/:callsign', (req, res) => {
	let query = {callsign: req.params.callsign}
	if (/^[0-9]+$/.test(req.params.callsign)) {
		// User ID
		query = {userId: parseInt(req.params.callsign)}
	}

	db.getDb().collection('activators').findOne(query, {projection: {'_id': false}}, (err, activator) => {
		if (err) {
			console.error(err);
			res.status(500).end();
			return;
		}
		if (!activator) {
			// Try alternative variations
			db.getDb().collection('activators').findOne({callsign: { $in: utils.makeCallsignVariations(req.params.callsign) }}, {projection: {'_id': false}}, (err, activator) => {
				if (activator) {
					res.json(activator);
				} else {
					res.status(404).end();
				}
			});
			return;
		}

		res.json(activator);
	});
});

app.get('/map_server', (req, res) => {
	if (!geoLookup) {
		res.status(503).end();
		return;
	}
	let mapServer = 'us';
	let geo = geoLookup.get(req.ip);
	if (geo.continent.code === 'AF' || geo.continent.code === 'EU') {
		mapServer = 'eu';
	}
	res.json({mapServer});
});

app.get('/my_coordinates', (req, res) => {
	if (!geoLookup) {
		res.status(503).end();
		return;
	}
	let geo = geoLookup.get(req.ip);
	if (!geo) {
		res.json({});
	} else {
		res.json({latitude: geo.location.latitude, longitude: geo.location.longitude});
	}
});

app.get('/my_country', (req, res) => {
	if (!geoLookup) {
		res.status(503).end();
		return;
	}
	let geo = geoLookup.get(req.ip);
	if (!geo) {
		res.json({});
	} else {
		res.json({country: geo.country.iso_code});
	}
});

app.post('/mapsession', (req, res) => {
	let date = moment().format('YYYY-MM-DD');
	db.getDb().collection('mapsessions').updateOne({"date": date}, {"$inc": {"count": 1}}, {upsert: true});
	res.json({});
});

app.listen(config.http.port, config.http.host);
