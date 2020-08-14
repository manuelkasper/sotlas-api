const moment = require('moment');
const db = require('./db');

module.exports = {
	lookupSummits: function(objects) {
		// Get all summit refs so we can look them all up in one go
		let summitCodes = new Set();
		let associationCodes = new Set();
		objects.forEach(obj => {
			summitCodes.add(obj.summit.code);
			associationCodes.add(obj.summit.code.substring(0, obj.summit.code.indexOf('/')));
		});

		return new Promise((resolve, reject) => {
			db.getDb().collection('summits').find({code: {$in: [...summitCodes]}}, {projection: {'_id': false, code: true, name: true, altitude: true, points: true, coordinates: true, activationCount: true, validFrom: true, validTo: true, 'photos.author': true}})
				.toArray((err, summits) => {
					if (err) {
						reject(err);
						return;
					}

					let summitMap = {};
					let now = moment();
					summits.forEach(summit => {
						if (now.isBefore(summit.validFrom) || now.isAfter(summit.validTo)) {
							summit.invalid = true;
						}
						delete summit.validFrom;
						delete summit.validTo;
						if (summit.photos) {
							let photoAuthors = new Set();
							summit.photos.forEach(photo => {
								photoAuthors.add(photo.author);
							});
							summit.photoAuthors = [...photoAuthors];
							delete summit.photos;
						}
						summitMap[summit.code] = summit;
					});

					db.getDb().collection('associations').find({code: {$in: [...associationCodes]}}).toArray((err, associations) => {
						if (err) {
							reject(err);
							return;
						}

						let associationMap = {};
						associations.forEach(association => {
							associationMap[association.code] = association;
						});

						objects.forEach(object => {
							let association = object.summit.code.substring(0, object.summit.code.indexOf('/'));
							if (summitMap[object.summit.code]) {
								object.summit = summitMap[object.summit.code];
								if (object.summit) {
									object.summit.isoCode = associationMap[association].isoCode;
									object.summit.continent = associationMap[association].continent;
								}
							}
						});

						resolve(objects);
					});
			});
		});
	}
}
