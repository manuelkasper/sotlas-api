var config = {};
module.exports = config;

config.http = {
	host: '127.0.0.1',
	port: 8081
};

config.mongodb = {
	url: 'mongodb://sotlas:XXXXXXXX@localhost:27017/sotlas',
	dbName: 'sotlas',
	batchSize: 1000
};

config.sotaspots = {
	initialLoadSpots: -24,
	periodicLoadSpots: 100,
	maxSpotAge: 86400000,
	updateInterval: 30000,
	url: 'https://api2.sota.org.uk/api/spots'
};

config.alerts = {
	minUpdateInterval: 60000,
	url: 'https://api2.sota.org.uk/api/alerts/12'
};

config.rbn = {
	server: {
		host: 'telnet.reversebeacon.net',
		port: 7000
	},
	login: "HB9DQM-3",
	timeout: 180000,
	maxSpotHistory: 1000
};

config.geoip = {
	path: 'GeoLite2-City.mmdb'
};

config.summitListUrl = 'https://www.sotadata.org.uk/summitslist.csv';

config.sotatrailsUrl = 'https://sotatrails.ch/api.php';

config.photos = {
	paths: {
		original: '/data/images/photos/original',
		thumb: '/data/images/photos/thumb',
		large: '/data/images/photos/large'
	},
	sizes: {
		large: {
			width: 1600,
			height: 1600
		},
		thumb: {
			width: 512,
			height: 256
		}
	},
	uploadPath: '/data/upload/photos'
};

config.tracks = {
	paths: {
		original: '/data/tracks/original',
		simple: '/data/tracks/simple'
	},
	tolerance: 0.00001,
	uploadPath: '/data/upload/tracks'
};

config.sso = {
	jwksUri: 'https://sso.sota.org.uk/auth/realms/SOTA/protocol/openid-connect/certs'
};

config.mail = {
	host: "neon1.net",
	port: 587
};

config.solardata = {
	apiKey: 'xxxxxxxxxxxxxxxxx'
};
