const axios = require('axios');
const wsManager = require('./ws-manager');
const config = require('./config');
const db = require('./db');
const TreeMap = require("treemap-js");

const latestSpots = new TreeMap();
const maxSpots = 100;
const updateInterval = 30000;
let lastUpdate = null;

wsManager.on('connect', (ws) => {
	let spots = []
	latestSpots.each(spot => {
		spots.push(spot)
	});
	wsManager.unicast({spots}, ws);
})

loadSpots();
setInterval(loadSpots, updateInterval);

function loadSpots() {
	console.log('load spots');
	axios.get('https://sota-api2.azurewebsites.net/api/spots/' + maxSpots + '/all')
		.then(response => {
			response.data.forEach(spot => {
				spot.summit = {code: spot.associationCode + '/' + spot.summitCode};
				delete spot.associationCode;
				delete spot.summitCode;
				delete spot.summitDetails;
				delete spot.highlightColor;
				if (spot.comments === '(null)') {
					spot.comments = '';
				}
				updateSpot(spot);
			});
		});
}

function updateSpot(spot) {
	// Check if we already have this spot in the list, and if it has changed
	if (spotsAreEqual(latestSpots.get(spot.id), spot)) {
		return;
	}

	// Spot is new or modified
	console.log("New/modified spot id " + spot.id);
	lookupSummit(spot.summit.code)
		.then(summit => {
			if (summit) {
				spot.summit = summit;
			}

			latestSpots.set(spot.id, spot);
			while (latestSpots.getLength() > maxSpots) {
				latestSpots.remove(latestSpots.getMinKey());
			}
			wsManager.broadcast({spot});
		})
}

function lookupSummit(summitCode, callback) {
	return db.getDb().collection('summits').findOne({code: summitCode}, {projection: {'_id': false, code: true, name: true, altitude: true, points: true, activationCount: true}});
}

function spotsAreEqual(spot1, spot2) {
	if (spot1 === undefined || spot2 === undefined) {
		return false;
	}
	return (spot1.id === spot2.id && spot1.comments === spot2.comments && spot1.callsign === spot2.callsign &&
		spot1.summit.code === spot2.summit.code && spot1.activatorCallsign === spot2.activatorCallsign &&
		spot1.frequency === spot2.frequency && spot1.mode === spot2.mode);
}
