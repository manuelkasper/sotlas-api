var config = {};
module.exports = config;

config.http = {
	host: undefined,
	port: 8081
};

config.mongodb = {
	url: process.env.MONGODB_URL,
	dbName: process.env.MONGODB_DBNAME,
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

config.summitListUrl = 'https://www.sotadata.org.uk/summitslist.csv';

config.sotatrailsUrl = 'https://sotatrails.ch/api.php';

config.photos = {
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
	uploadPath: '/tmp/upload/photos',
	originalStorage: {
		endPoint: 's3.eu-central-003.backblazeb2.com',
    	accessKey: process.env.B2_ACCESS_KEY,
    	secretKey: process.env.B2_SECRET_KEY,
    	bucketName: 'sotlas-photos'
	},
	storage: {
		endPoint: 'fra1.digitaloceanspaces.com',
		accessKey: process.env.SPACES_ACCESS_KEY,
		secretKey: process.env.SPACES_SECRET_KEY,
    	bucketName: 'sotlas-photos'
	}
};

config.tracks = {
	paths: {
		original: '/data/tracks/original',
		simple: '/data/tracks/simple'
	},
	tolerance: 0.00001,
	uploadPath: '/tmp/upload/tracks'
};

config.sso = {
	jwksUri: 'https://sso.sota.org.uk/auth/realms/SOTA/protocol/openid-connect/certs'
};

config.mail = {
	host: process.env.MAIL_HOST,
	port: process.env.MAIL_PORT
};

config.solardata = {
	apiKey: process.env.SOLARDATA_API_KEY
};
