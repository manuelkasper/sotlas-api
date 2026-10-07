const { isSafePattern } = require('redos-detector');

const REGEX_CHECK_OPTIONS = {
	caseInsensitive: true,
	timeout: 250,
	maxSteps: 20000,
	downgradePattern: false
};

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
	},

	// True when pattern is a case-insensitive regex that will not backtrack
	// catastrophically. Literals, anchors, and .* are allowed. Invalid patterns
	// and checker timeouts are rejected.
	isSafeRegex(pattern, options) {
		let maxLength = options && options.maxLength !== undefined ? options.maxLength : 100;
		if (typeof pattern !== 'string' || pattern.length === 0 || pattern.length > maxLength || pattern.includes('\0')) {
			return false;
		}
		// A pattern with no metacharacters is a literal. Case-insensitive literals
		// of repeated letters make redos-detector report a false positive.
		if (!/[.*+?^${}()|[\]\\]/.test(pattern)) {
			return true;
		}
		try {
			new RegExp(pattern, 'i');
		} catch (e) {
			return false;
		}
		try {
			return isSafePattern(pattern, REGEX_CHECK_OPTIONS).safe === true;
		} catch (e) {
			// The checker only accepts patterns with a start anchor. Its default
			// downgrade prefixes "[^]*?", which overlaps a leading ".*" and rejects
			// safe searches such as ".*horn". Anchor a copy for the check only.
			if (!/not bounded at the start/.test(e.message)) {
				return false;
			}
		}
		try {
			return isSafePattern('^(?:' + pattern + ')', REGEX_CHECK_OPTIONS).safe === true;
		} catch (e) {
			return false;
		}
	},

	anonymizeIP(ip) {
		if (!ip) return null;
		// Handle IPv4 addresses
		if (ip.includes('.')) {
			let parts = ip.split('.');
			if (parts.length === 4) {
				return parts.slice(0, 3).join('.') + '.0';
			}
		}
		// Handle IPv6 addresses - keep first 64 bits (first 4 groups)
		if (ip.includes(':')) {
			let parts = ip.split(':');
			if (parts.length >= 4) {
				return parts.slice(0, 4).join(':') + '::';
			}
		}
		return ip;
	}
};
