const axios = require('axios');
const express = require('express');
const config = require('./config');
const summits = require('./summits');

let router = express.Router();
module.exports = router;

let alertCache = [];
let lastLoadDate;
let pendingLoad;

router.get('/', (req, res) => {
	res.cacheControl = {
		noCache: true
	};

	loadAlerts(req.query.noCache)
		.then(alerts => {
			res.json(alerts);
		})
		.catch(err => {
			console.error(err);
			res.status(500).end();
		})
});

function loadAlerts(noCache) {
	if (noCache) {
		console.log('Load alerts (no cache)');
		return loadAlertsDirect();
	}

	if (lastLoadDate && (new Date() - lastLoadDate) < config.alerts.minUpdateInterval) {
		return Promise.resolve(alertCache);
	}

	if (!pendingLoad) {
		console.log('Load alerts (cache)');
		pendingLoad = loadAlertsDirect()
			.then(response => {
				pendingLoad = null;
				return response;
			})
			.catch(err => {
				pendingLoad = null;
				return Promise.reject(err);
			})
	}

	return pendingLoad;
}

function loadAlertsDirect() {
	// TODO: check epoch and only load alerts list if the epoch has changed since the last load
	return axios.get(config.alerts.url)
		.then(response => {
			if (response.status !== 200) {
				console.error(`Got status ${response.status} when loading alerts`);
				return Promise.reject('Cannot load alerts from SOTAwatch');
			}

			let newAlerts = response.data.map(alert => {
				return {
					id: alert.id,
					userID: alert.userID,
					timeStamp: new Date(alert.timeStamp),
					dateActivated: new Date(alert.dateActivated),
					summit: {code: alert.associationCode + '/' + alert.summitCode},
					activatorCallsign: alert.activatingCallsign.toUpperCase().replace(/[^A-Z0-9\/-]/g, ''),
					posterCallsign: alert.posterCallsign,
					frequency: alert.frequency,
					comments: alert.comments !== '(null)' ? alert.comments : ''
				};
			});

			return summits.lookupSummits(newAlerts)
				.then(alerts => {
					alertCache = alerts;
					lastLoadDate = new Date();
					return alerts;
				});
		})
}
