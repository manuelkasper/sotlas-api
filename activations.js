const axios = require('axios');
const moment = require('moment');
const express = require('express');
const config = require('./config');
const db = require('./db');
const summits = require('./summits');

let router = express.Router();
module.exports = router;

router.get('/:callsign', (req, res) => {
	res.cacheControl = {
		noCache: true
	};

	let query = {callsign: req.params.callsign}
	if (/^[0-9]+$/.test(req.params.callsign)) {
		// User ID
		query = {userId: req.params.callsign}
	}

	db.getDb().collection('activators').findOne(query, (err, activator) => {
		if (err) {
			res.status(500).end();
			return;
		}
		if (!activator) {
			res.status(404).end();
			return;
		}

		axios.get('https://api-db2.sota.org.uk/logs/activator/' + activator.userId + '/99999/1')
			.then(response => {
				let activations = response.data.map(activation => {
					return {
						id: activation.ActivationId,
						date: moment.utc(activation.ActivationDate).toDate(),
						callsignUsed: activation.OwnCallsign,
						qsos: activation.QSOs,
						modeQsos: extractModeQsos(activation),
						bandQsos: extractBandQsos(activation),
						points: activation.Points,
						bonus: activation.BonusPoints,
						summit: {
							code: activation.SummitCode
						}
					}
				}).reverse();
				summits.lookupSummits(activations)
					.then(activationsWithSummits => {
						res.json(activationsWithSummits);
					})
			})
			.catch(error => {
				console.error(error);
				if (error.response && error.response.status === 401) {
					res.status(401);
				} else {
					res.status(500);
				}
				res.end();
				return;
			})
	});
});

function extractModeQsos(activation) {
	return {
		'cw': activation.QSOcw,
		'ssb': activation.QSOssb,
		'fm': activation.QSOfm
	}
}

function extractBandQsos(activation) {
	let bands = ['160','80','60','40','30','20','17','15','12','10','6','4','2','70c','23c'];
	let bandQsos = {};
	bands.forEach(band => {
		if (activation['QSO' + band] > 0) {
			bandQsos[band + 'm'] = activation['QSO' + band];
		}
	});
	return bandQsos;
}
