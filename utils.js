module.exports = {

	makeCallsignVariations(callsign) {
		let matches = callsign.match(/^(2[DEIJMUW]|G[DIJMUW]?|M[DIJMUW]?)(\d[A-Z]{2,3})$/)
		if (matches) {
			if (matches[1].substring(0, 1) === '2') {
				return ['2D' + matches[2], '2E' + matches[2], '2I' + matches[2], '2J' + matches[2], '2M' + matches[2], '2U' + matches[2], '2W' + matches[2]];
			} else if (matches[1].substring(0, 1) === 'G') {
				return ['GD' + matches[2], 'G' + matches[2], 'GI' + matches[2], 'GJ' + matches[2], 'GM' + matches[2], 'GU' + matches[2], 'GW' + matches[2]];
			} else if (matches[1].substring(0, 1) === 'M') {
				return ['MD' + matches[2], 'M' + matches[2], 'MI' + matches[2], 'MJ' + matches[2], 'MM' + matches[2], 'MU' + matches[2], 'MW' + matches[2]];
			}
		} else {
			return [callsign];
		}
	}
};
