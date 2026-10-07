const reconnect = require('reconnect-net');
const wsManager = require('./ws-manager');
const carrier = require('carrier');
const config = require('./config');
const db = require('./db');
const utils = require('./utils');

const rbnSpotRegex = /^DX de (\S+):\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+dB\s+(\S+)\s+\S+\s+(CQ|DX)\s+(\d+)Z$/;
const CALLSIGN_PATTERN = /^[A-Z0-9/-]{1,20}$/i;
const MAX_FILTER_CALLSIGNS = 50;
const DEFAULT_FILTER_AGE_MS = 3600000;
const MAX_FILTER_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function sanitizeRbnFilter(input) {
	if (!input || typeof input !== 'object' || Array.isArray(input)) {
		return null;
	}

	let homeCallsign = null;
	if (input.homeCallsign !== undefined && input.homeCallsign !== null) {
		let rawCalls = input.homeCallsign;
		if (typeof rawCalls === 'string') {
			rawCalls = rawCalls.split(',').map(call => call.trim()).filter(call => call.length > 0);
		}
		if (!Array.isArray(rawCalls) || rawCalls.length === 0 || rawCalls.length > MAX_FILTER_CALLSIGNS) {
			return null;
		}
		homeCallsign = [];
		for (let call of rawCalls) {
			if (typeof call !== 'string' || !CALLSIGN_PATTERN.test(call)) {
				return null;
			}
			homeCallsign.push(call.toUpperCase());
		}
	}

	if (input.isActivator !== undefined && input.isActivator !== false && input.isActivator !== true) {
		return null;
	}
	let isActivator = input.isActivator === true;

	if (!homeCallsign && !isActivator) {
		return null;
	}

	let maxAge = parseInt(input.maxAge, 10);
	if (!Number.isFinite(maxAge) || maxAge <= 0) {
		maxAge = DEFAULT_FILTER_AGE_MS;
	} else if (maxAge > MAX_FILTER_AGE_MS) {
		maxAge = MAX_FILTER_AGE_MS;
	}

	let filter = {
		homeCallsign,
		isActivator,
		maxAge
	};
	if (typeof input.viewId === 'string' && input.viewId.length > 0 && input.viewId.length <= 128) {
		filter.viewId = input.viewId;
	}
	return filter;
}

class RbnReceiver {
	start() {
		this.restartConnection();

		wsManager.on('message', (ws, message) => {
			if (!message || message.rbnFilter === undefined) {
				return;
			}
			let filter = sanitizeRbnFilter(message.rbnFilter);
			if (!filter) {
				return;
			}
			ws.rbnFilter = filter;
			this.sendSpotHistory(ws);
		});
	}
	
	restartConnection() {
		if (this.re)
			this.re.disconnect();

		this.resetTimer();
		this.re = reconnect((stream) => {
			console.log("Connected to RBN");
			stream.write(config.rbn.login + "\r\n");
			if (config.rbn.server.commands) {
				config.rbn.server.commands.forEach(command => {
					stream.write(command + "\r\n");
				});
			}
			
			carrier.carry(stream, (line) => {
				this.handleLine(line);
			});
		});
		
		this.re.on('error', (err) => {
			console.error(`RBN connection error: ${err}`);
		});
		
		this.re.connect(config.rbn.server);
	}
	
	resetTimer() {
		if (this.timeout) {
			clearTimeout(this.timeout);
		}
		
		this.timeout = setTimeout(() => {
			console.error("RBN: timeout, reconnecting");
			this.restartConnection();
		}, config.rbn.timeout);
	}
	
	handleLine(line) {
		this.resetTimer();
		let matches = rbnSpotRegex.exec(line);
		if (matches) {
			let spot = {
				timeStamp: new Date(),
				callsign: matches[3],
				homeCallsign: this.homeCallsign(matches[3]),
				spotter: matches[1].replace("-#", ""),
				frequency: parseFloat((matches[2]/1000).toFixed(4)),
				mode: matches[4],
				snr: parseInt(matches[5]),
				speed: parseInt(matches[6])
			};

			// Check if this is a known SOTA activator
			db.getDb().collection('activators').countDocuments({callsign: { $in: utils.makeCallsignVariations(spot.homeCallsign) }}, (error, result) => {
				if (result > 0) {
					spot.isActivator = true;
				}
				db.getDb().collection('rbnspots').insertOne(spot, (error, result) => {
					// _id has now been added, but not in our preferred format
					spot._id = spot._id.toHexString()
					wsManager.broadcast({'rbnSpot': spot}, (ws) => {
						if (!ws.rbnFilter) {
							return false;
						}

						if (ws.rbnFilter.homeCallsign && ws.rbnFilter.homeCallsign.includes(String(spot.homeCallsign || '').toUpperCase())) {
							return true;
						}

						if (ws.rbnFilter.isActivator && spot.isActivator) {
							return true;
						}

						return false;
					});
				});
			});
		}
	}

	sendSpotHistory(ws) {
		// Send the spot history for the currently defined RBN filter
		if (!ws.rbnFilter.homeCallsign && !ws.rbnFilter.isActivator) {
			return;
		}

		let query = {};

		if (ws.rbnFilter.homeCallsign) {
			query.homeCallsign = {$in: ws.rbnFilter.homeCallsign};
		}
		if (ws.rbnFilter.isActivator) {
			query.isActivator = true;
		}

		query.timeStamp = {$gte: new Date(new Date().getTime() - ws.rbnFilter.maxAge)};

		db.getDb().collection('rbnspots').find(query).sort({timeStamp: -1}).limit(config.rbn.maxSpotHistory).toArray((err, rbnSpots) => {
			if (err) {
				console.error(err);
				return;
			}

			rbnSpots.forEach(spot => {
				spot._id = spot._id.toHexString();
			});

			let response = {rbnSpotHistory: rbnSpots};
			if (ws.rbnFilter.viewId) {
				response.viewId = ws.rbnFilter.viewId;
			}
			wsManager.unicast(response, ws);
		});
	}

	homeCallsign(callsign) {
		let parts = callsign.split('/');
		let longestPart = '';
		parts.forEach(part => {
			if (part.length > longestPart.length) {
				longestPart = part;
			}
		})

		// For UK callsigns, normalize them all to 2E/G/M for the sake of comparison
		let matches = longestPart.match(/^(2[DEIJMUW]|G[DIJMUW]?|M[DIJMUW]?)(\d[A-Z]{2,3})$/)
		if (matches) {
			longestPart = matches[1].replace(/^2./, '2E').replace(/^G[DIJMUW]/, 'G').replace(/^M[DIJMUW]/, 'M') + matches[2]
		}
		return longestPart;
	}
}

module.exports = RbnReceiver;
