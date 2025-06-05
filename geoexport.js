const axios = require('axios');
const moment = require('moment');
const express = require('express');
const config = require('./config');
const db = require('./db');

let router = express.Router();
module.exports = router;

router.get('/associations/:association.gpx', (req, res) => {
	res.cacheControl = {
		noCache: true
	};

	res.set('Content-Type', 'application/gpx+xml');
	res.set('Content-Disposition', 'attachment; filename="' + req.params.association + '.gpx"');
	gpxForQuery('^' + req.params.association + '/', `SOTA Association ${req.params.association}`, req.query, (err, gpx) => {
		if (err) {
			console.error(err);
			res.status(500).end();
			return;
		}

		res.send(gpx).end();
	});
});

router.get('/associations/:association.kml', (req, res) => {
	res.cacheControl = {
		noCache: true
	};

	res.set('Content-Type', 'application/vnd.google-earth.kml+xml');
	res.set('Content-Disposition', 'attachment; filename="' + req.params.association + '.kml"');
	kmlForAssociation(req.params.association, req.query, (err, kml) => {
		if (err) {
			console.error(err);
			res.status(500).end();
			return;
		}

		if (!kml) {
			res.status(404).end();
			return;
		}

		res.send(kml).end();
	});
});

router.get('/associations/:association.geojson', (req, res) => {
	res.cacheControl = {
		noCache: true
	};

	res.set('Content-Type', 'application/geo+json');
	res.set('Content-Disposition', 'attachment; filename="' + req.params.association + '.geojson"');
	geoJsonForQuery('^' + req.params.association + '/', req.query, (err, geoJson) => {
		if (err) {
			console.error(err);
			res.status(500).end();
			return;
		}

		res.json(geoJson).end();
	});
});

router.get('/regions/:association/:region.gpx', (req, res) => {
	res.cacheControl = {
		noCache: true
	};

	res.set('Content-Type', 'application/gpx+xml');
	res.set('Content-Disposition', 'attachment; filename="' + req.params.association + '_' + req.params.region + '.gpx"');
	gpxForQuery('^' + req.params.association + '/' + req.params.region + '-', `SOTA Region ${req.params.association + '/' + req.params.region}`, req.query, (err, gpx) => {
		if (err) {
			console.error(err);
			res.status(500).end();
			return;
		}

		res.send(gpx).end();
	});
});

router.get('/regions/:association/:region.kml', (req, res) => {
	res.cacheControl = {
		noCache: true
	};

	res.set('Content-Type', 'application/vnd.google-earth.kml+xml');
	res.set('Content-Disposition', 'attachment; filename="' + req.params.association + '_' + req.params.region + '.kml"');
	kmlForRegion(req.params.association, req.params.region, req.query, (err, kml) => {
		if (err) {
			console.error(err);
			res.status(500).end();
			return;
		}

		if (!kml) {
			res.status(404).end();
			return;
		}

		res.send(kml).end();
	});
});

router.get('/regions/:association/:region.geojson', (req, res) => {
	res.cacheControl = {
		noCache: true
	};

	res.set('Content-Type', 'application/geo+json');
	res.set('Content-Disposition', 'attachment; filename="' + req.params.association + '_' + req.params.region + '.geojson"');
	geoJsonForQuery('^' + req.params.association + '/' + req.params.region + '-', req.query, (err, geoJson) => {
		if (err) {
			console.error(err);
			res.status(500).end();
			return;
		}

		res.json(geoJson).end();
	});
});


function gpxForQuery(query, name, options, callback) {
	let filter = {code: {$regex: query}};
	if (!options.inactive) {
		filter.validFrom = {$lte: new Date()};
		filter.validTo = {$gte: new Date()};
	}
	db.getDb().collection('summits').find(filter).sort({code: 1}).toArray((err, summits) => {
		if (err) {
			callback(err);
			return;
		}

		let minlat, minlon, maxlat, maxlon;
		summits.forEach(summit => {
			if (!minlat || summit.coordinates.latitude < minlat) {
				minlat = summit.coordinates.latitude;
			}
			if (!minlon || summit.coordinates.longitude < minlon) {
				minlon = summit.coordinates.longitude;
			}
			if (!maxlat || summit.coordinates.latitude > maxlat) {
				maxlat = summit.coordinates.latitude;
			}
			if (!maxlon || summit.coordinates.longitude > maxlon) {
				maxlon = summit.coordinates.longitude;
			}
		});

		let now = moment.utc();
		let gpx = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<gpx version="1.1" 
     creator="SOTLAS" 
     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" 
     xmlns="http://www.topografix.com/GPX/1/1" 
     xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${name}</name>
    <author>
      <name>SOTLAS</name>
    </author>
    <link href="https://sotl.as">
      <text>SOTLAS</text>
    </link>
    <time>${now.toISOString()}</time>
    <bounds minlat="${minlat}" minlon="${minlon}" maxlat="${maxlat}" maxlon="${maxlon}"/>
  </metadata>
`;
		
		summits.forEach(summit => {
			gpx += `  <wpt lat="${summit.coordinates.latitude}" lon="${summit.coordinates.longitude}">
    <ele>${summit.altitude}</ele>
    <name><![CDATA[${summitName(summit, options)}]]></name>
    <cmt><![CDATA[${summit.name}]]></cmt>
    <sym>SOTA${('0' + summit.points).substr(-2)}</sym>
    <type>Summit</type>
  </wpt>
`;
		});

		gpx += "</gpx>";
		callback(null, gpx);
	});
}

// Styles for KML export
// Note: these style IDs have a special meaning in the Organic Maps app (https://organicmaps.app), as it ignores external icon images.
const KML_STYLES = `
    <Style id="placemark-red">
      <IconStyle>
        <Icon>
          <href>https://sotl.as/summit-circles/summit-circle-10pt.png</href>
        </Icon>
      </IconStyle>
    </Style>
    <Style id="placemark-deeporange">
      <IconStyle>
        <Icon>
          <href>https://sotl.as/summit-circles/summit-circle-8pt.png</href>
        </Icon>
      </IconStyle>
    </Style>
    <Style id="placemark-orange">
      <IconStyle>
        <Icon>
          <href>https://sotl.as/summit-circles/summit-circle-6pt.png</href>
        </Icon>
      </IconStyle>
    </Style>
    <Style id="placemark-brown">
      <IconStyle>
        <Icon>
          <href>https://sotl.as/summit-circles/summit-circle-4pt.png</href>
        </Icon>
      </IconStyle>
    </Style>
    <Style id="placemark-lime">
      <IconStyle>
        <Icon>
          <href>https://sotl.as/summit-circles/summit-circle-2pt.png</href>
        </Icon>
      </IconStyle>
    </Style>
    <Style id="placemark-green">
      <IconStyle>
        <Icon>
          <href>https://sotl.as/summit-circles/summit-circle-1pt.png</href>
        </Icon>
      </IconStyle>
    </Style>
`;


function getStyle(points) {
	if (points === 10) {
		return 'red';
	}
	if (points >= 8) {
		return 'deeporange';
	}
	if (points >= 6) {
		return 'orange';
	}
	if (points >= 4) {
		return 'brown';
	}
	if (points >= 2) {
		return 'lime';
	}
	if (points >= 1) {
		return 'green';
	}
	return 'green';
}

function kmlForAssociation(associationCode, options, callback) {
	db.getDb().collection('associations').findOne({code: associationCode}, (err, association) => {
		if (err) {
			callback(err);
			return;
		}

		if (!association) {
			callback(null, null);
			return;
		}

		let filter = {code: {$regex: "^" + association.code + "/"}};
		if (!options.inactive) {
			filter.validFrom = {$lte: new Date()};
			filter.validTo = {$gte: new Date()};
		}
		db.getDb().collection('summits').find(filter).sort({code: 1}).toArray((err, summits) => {
			let now = moment.utc();
			let kmlName = 'SOTA Association ' + association.code + ' - ' + association.name;
			let kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:atom="http://www.w3.org/2005/Atom">
  <Document>
    <atom:author><![CDATA[SOTLAS]]></atom:author>
    <atom:link href="https://sotl.as/summits/${association.code}"/>
    <name><![CDATA[${kmlName}]]></name>
    <TimeStamp>
      <when>${now.toISOString()}</when>
    </TimeStamp>
`;
			// add styles for placemarks 
			kml += KML_STYLES;

			association.regions.forEach(region => {
				kml += `    <Folder>
      <name><![CDATA[${association.code}/${region.code} - ${region.name}]]></name>
      <atom:link href="https://sotl.as/summits/${association.code}/${region.code}"/>
`;
				
				summits.filter(summit => {return summit.code.startsWith(association.code + '/' + region.code)}).forEach(summit => {
					kml += kmlForSummit(summit, options);
				});

				kml += `    </Folder>
`;
			});

			kml += `  </Document>
</kml>
`;

			callback(null, kml);
		});
	});
}

function kmlForRegion(associationCode, regionCode, options, callback) {
	db.getDb().collection('associations').findOne({code: associationCode}, (err, association) => {
		if (err) {
			callback(err);
			return;
		}

		if (!association) {
			callback(null, null);
			return;
		}

		let filter = {code: {$regex: "^" + association.code + "/" + regionCode + '-'}};
		if (!options.inactive) {
			filter.validFrom = {$lte: new Date()};
			filter.validTo = {$gte: new Date()};
		}
		db.getDb().collection('summits').find(filter).sort({code: 1}).toArray((err, summits) => {
			let now = moment.utc();
			let kmlName = 'SOTA Region ' + associationCode + '/' + regionCode;
			let kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:atom="http://www.w3.org/2005/Atom">
  <Document>
    <atom:author><![CDATA[SOTLAS]]></atom:author>
    <TimeStamp>
      <when>${now.toISOString()}</when>
    </TimeStamp>
`;

			// add styles for placemarks 
			kml += KML_STYLES;
			
			association.regions.forEach(region => {
				if (regionCode && region.code !== regionCode) {
					return;
				}
				kml += `    <name>SOTA Region <![CDATA[${association.code}/${region.code} - ${region.name}]]></name>
    <atom:link href="https://sotl.as/summits/${association.code}/${region.code}"/>
`;
				
				summits.filter(summit => {return summit.code.startsWith(association.code + '/' + region.code)}).forEach(summit => {
					kml += kmlForSummit(summit, options);
				});
			});

			kml += `  </Document>
</kml>
`;

			callback(null, kml);
		});
	});
}

function geoJsonForQuery(query, options, callback) {
	let filter = {code: {$regex: query}};
	if (!options.inactive) {
		filter.validFrom = {$lte: new Date()};
		filter.validTo = {$gte: new Date()};
	}
	db.getDb().collection('summits').find(filter).sort({code: 1}).toArray((err, summits) => {
		if (err) {
			callback(err);
			return;
		}

		let features = summits.map(summit => {
			return {
				type: 'Feature',
				geometry: {
					type: 'Point',
					coordinates: [summit.coordinates.longitude, summit.coordinates.latitude]
				},
				id: summit.code,
				properties: {
					code: summit.code,
					name: summit.name,
					title: summitName(summit, options)
				}
			}
		})

		let geojson = {
			type: 'FeatureCollection',
			features
		}

		callback(null, geojson);
	});
}

function summitName(summit, options) {
	let name = summit.code;
	let nameopts = [];
	if (options.nameopts) {
		nameopts = options.nameopts.split(',')
	}
	if (nameopts.includes('name')) {
		name += ' - ' + summit.name;
	}
	if (nameopts.includes('altitude')) {
		name += ', ' + summit.altitude + 'm';
	}
	if (nameopts.includes('points')) {
		name += ', ' + summit.points + 'pt';
	}
	return name;
}

function kmlForSummit(summit, options) {
	return `      <Placemark id="${summit.code}">
        <name><![CDATA[${summitName(summit, options)}]]></name>
        <description><![CDATA[${summit.name}, ${summit.altitude}m, ${summit.points}pt]]></description>
        <Point>
          <coordinates>${summit.coordinates.longitude},${summit.coordinates.latitude},${summit.altitude}</coordinates>
        </Point>
        <styleUrl>#placemark-${getStyle(summit.points)}</styleUrl>
      </Placemark>
`;
}
