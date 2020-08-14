const config = require('../config')
const db = require('../db')
const sharp = require('sharp')

function regenerateThumbnails() {
	// Fetch all summits with photos
	db.getDb().collection('summits').find({'photos': {$exists: true, $ne: []}})
		.each((err, summit) => {
			if (summit) {
				summit.photos.forEach(photo => {
					regenerateThumbnailForPhoto(photo)
				})
			} else {
				db.closeDb()
			}
		})
}

function regenerateThumbnailForPhoto(photo) {
	console.dir(photo)

	let sizeDescr = 'thumb'
    let originalPath = config.photos.paths.original + '/' + photo.filename.substr(0, 2) + '/' + photo.filename
	let outPath = config.photos.paths[sizeDescr] + '/' + photo.filename.substr(0, 2) + '/' + photo.filename
	makeResized(originalPath, outPath, config.photos.sizes[sizeDescr].width, config.photos.sizes[sizeDescr].height)
}

function makeResized(src, dst, maxWidth, maxHeight) {
	return sharp(src).rotate().resize({ height: maxHeight, width: maxWidth, fit: 'inside' }).toFile(dst)
}

db.waitDb(regenerateThumbnails)
