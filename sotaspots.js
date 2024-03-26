const axios = require('axios');
const wsManager = require('./ws-manager');
const config = require('./config');
const db = require('./db');
const TreeMap = require("treemap-js");

class SotaSpotReceiver {
	constructor() {
		this.latestSpots = new TreeMap();
		this.lastUpdate = null;

		wsManager.on('connect', (ws) => {
			let spots = []
			this.latestSpots.each(spot => {
				spots.push(spot)
			});
			wsManager.unicast({spots}, ws);
		})
	}

	start() {
		this.loadSpots();
		setInterval(() => {
			this.loadSpots();
		}, config.sotaspots.updateInterval);
	}

	loadSpots() {
		let numSpotsToLoad = config.sotaspots.periodicLoadSpots;
		if (this.latestSpots.getLength() == 0) {
			numSpotsToLoad = config.sotaspots.initialLoadSpots;
		}
		console.log(`Load ${numSpotsToLoad} spots`);
		axios.get(config.sotaspots.url + '/' + numSpotsToLoad + '/all')
			.then(response => {
				let minSpotId = undefined;
				let currentSpotIds = new Set();
				response.data.forEach(spot => {
					spot.summit = {code: spot.associationCode.toUpperCase().trim() + '/' + spot.summitCode.toUpperCase().trim()};
					spot.timeStamp = new Date(spot.timeStamp);
					spot.activatorCallsign = spot.activatorCallsign.toUpperCase().replace(/[^A-Z0-9\/-]/g, '')
					delete spot.associationCode;
					delete spot.summitCode;
					delete spot.summitDetails;
					delete spot.highlightColor;
					delete spot.activatorName;
					if (spot.comments === '(null)') {
						spot.comments = '';
					}
					this.updateSpot(spot);

					currentSpotIds.add(spot.id);
					if (minSpotId === undefined || spot.id < minSpotId) {
						minSpotId = spot.id;
					}
				});
				this.removeDeletedSpots(minSpotId, currentSpotIds);
				this.removeExpiredSpots();
			})
			.catch(error => {
				console.error(error);
			});
	}

	updateSpot(spot) {
		// Check if we already have this spot in the list, and if it has changed
		if (this.spotsAreEqual(this.latestSpots.get(spot.id), spot)) {
			return;
		}

		// Spot is new or modified
		console.log("New/modified spot id " + spot.id);
		this.lookupSummit(spot.summit.code)
			.then(summit => {
				if (summit) {
					spot.summit = summit;
				}

				this.lookupAssociation(spot.summit.code.substring(0, spot.summit.code.indexOf('/')))
					.then(association => {
						if (association) {
							spot.summit.isoCode = association.isoCode;
							spot.summit.continent = association.continent;
						}

						this.latestSpots.set(spot.id, spot);
						wsManager.broadcast({spot});
					})
			})
	}

	deleteSpotById(spotId) {
		console.log("Deleted spot id " + spotId);
		if (this.latestSpots.get(spotId) !== undefined) {
			this.latestSpots.remove(spotId);
			wsManager.broadcast({deleteSpot: {id: spotId}});
		}
	}

	removeDeletedSpots(minSpotId, currentSpotIds) {
		// Consider all spots with ID >= minSpotId and not in currentSpotIds as deleted
		this.latestSpots.each((spot, curId) => {
			if (curId >= minSpotId && !currentSpotIds.has(curId)) {
				this.deleteSpotById(curId);
			}
		});
	}

	removeExpiredSpots() {
		let now = new Date();
		while (this.latestSpots.getLength() > 0) {
			let minKey = this.latestSpots.getMinKey();
			if ((now - this.latestSpots.get(minKey).timeStamp) > config.sotaspots.maxSpotAge) {
				console.log('Remove spot ID ' + minKey);
				this.latestSpots.remove(minKey);
			} else {
				break;
			}
		}
	}

	lookupSummit(summitCode, callback) {
		return db.getDb().collection('summits').findOne({code: summitCode}, {projection: {'_id': false, code: true, name: true, altitude: true, points: true, activationCount: true}});
	}

	lookupAssociation(associationCode, callback) {
		return db.getDb().collection('associations').findOne({code: associationCode});
	}

	spotsAreEqual(spot1, spot2) {
		if (spot1 === undefined || spot2 === undefined) {
			return false;
		}
		return (spot1.id === spot2.id && spot1.comments === spot2.comments && spot1.callsign === spot2.callsign &&
			spot1.summit.code === spot2.summit.code && spot1.activatorCallsign === spot2.activatorCallsign &&
			spot1.frequency === spot2.frequency && spot1.mode === spot2.mode);
	}
}

module.exports = SotaSpotReceiver;
