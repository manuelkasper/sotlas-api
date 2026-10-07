const express = require('express')
const fsPromises = require('fs').promises
const multer  = require('multer')
const config = require('./config')
const photos = require('./photos')
const ssoJwt = require('./sso')
const db = require('./db')

let upload = multer({
  dest: config.photos.uploadPath,
  limits: {
    fileSize: config.photos.maxUploadBytes,
    files: config.photos.maxUploadFiles
  }
})

function uploadPhotos(req, res, next) {
  upload.array('photo', config.photos.maxUploadFiles)(req, res, (err) => {
    if (!err) {
      next()
      return
    }
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).end()
      return
    }
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
      res.status(400).end()
      return
    }
    console.error(err)
    res.status(400).end()
  })
}

let router = express.Router()
module.exports = router

let jwtCallback = ssoJwt()

function endServerError(res, err) {
  console.error(err)
  if (!res.headersSent) {
    res.status(500).end()
  }
}

async function removeTempUploads(files) {
  if (!Array.isArray(files)) {
    return
  }
  await Promise.all(files.map(file => {
    if (!file || !file.path) {
      return
    }
    return fsPromises.unlink(file.path).catch(err => {
      if (err.code !== 'ENOENT') {
        console.error(err)
      }
    })
  }))
}

router.post('/summits/:association/:code/upload', jwtCallback, uploadPhotos, async (req, res) => {
  try {
    res.cacheControl = {
      noCache: true
    }
    
    if (!req.auth.callsign) {
      res.status(401).send('Missing callsign in SSO token').end()
      return
    }

    let summitCode = req.params.association + '/' + req.params.code
    let summit = await db.getDb().collection('summits').findOne({code: summitCode})
    if (!summit) {
      res.status(404).end()
      return
    }

    if (req.files) {
      let dbPhotos = []
      for (let file of req.files) {
        let photo = await photos.importPhoto(file.path, req.auth.callsign)
        dbPhotos.push(photo)
      }

      // Check for duplicates
      if (summit.photos) {
        dbPhotos = dbPhotos.filter(photo => !summit.photos.some(summitPhoto => summitPhoto.filename === photo.filename ))
      }

      if (dbPhotos.length > 0) {
        await db.getDb().collection('summits').updateOne({code: summitCode}, { $push: { photos: { $each: dbPhotos } } })
      }

      res.json(dbPhotos)
    } else {
      res.status(400).end()
    }
  } catch (err) {
    endServerError(res, err)
  } finally {
    await removeTempUploads(req.files)
  }
})

function findSummitPhoto(summit, filename) {
  if (!summit || !Array.isArray(summit.photos)) {
    return null
  }
  return summit.photos.find(photo => photo.filename === filename) || null
}

router.delete('/summits/:association/:code/:filename', jwtCallback, async (req, res) => {
  try {
    res.cacheControl = {
      noCache: true
    }

    if (!req.auth.callsign) {
      res.status(401).send('Missing callsign in SSO token').end()
      return
    }

    let summitCode = req.params.association + '/' + req.params.code
    let summit = await db.getDb().collection('summits').findOne({code: summitCode})
    let photo = findSummitPhoto(summit, req.params.filename)
    if (!photo) {
      res.status(404).end()
      return
    }

    // Check that uploader is currently logged in user
    if (photo.author !== req.auth.callsign) {
      res.status(401).send('Cannot delete another user\'s photos').end()
      return
    }

    await db.getDb().collection('summits').updateOne({code: summitCode}, { $pull: { photos: { filename: req.params.filename } } })

    res.status(204).end()
  } catch (err) {
    endServerError(res, err)
  }
})

router.post('/summits/:association/:code/reorder', jwtCallback, async (req, res) => {
  try {
    res.cacheControl = {
      noCache: true
    }

    if (!req.auth.callsign) {
      res.status(401).send('Missing callsign in SSO token').end()
      return
    }

    let filenames = req.body && req.body.filenames
    if (!Array.isArray(filenames) || filenames.length > 500 || filenames.some(filename => typeof filename !== 'string' || filename.length === 0 || filename.length > 128)) {
      res.status(400).end()
      return
    }

    let summitCode = req.params.association + '/' + req.params.code

    // Assign new sortOrder index to photos of this user, in the order given by req.body.filenames
    let updates = filenames.map((filename, index) => {
      return db.getDb().collection('summits').updateOne(
        { code: summitCode, photos: { $elemMatch: { author: req.auth.callsign, filename } } },
        { $set: { 'photos.$.sortOrder': index + 1 } }
      )
    })

    await Promise.all(updates)

    res.status(204).end()
  } catch (err) {
    endServerError(res, err)
  }
})

router.post('/summits/:association/:code/:filename', jwtCallback, async (req, res) => {
  try {
    res.cacheControl = {
      noCache: true
    }

    if (!req.auth.callsign) {
      res.status(401).send('Missing callsign in SSO token').end()
      return
    }

    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      res.status(400).end()
      return
    }

    let summitCode = req.params.association + '/' + req.params.code
    let summit = await db.getDb().collection('summits').findOne({code: summitCode})
    let photo = findSummitPhoto(summit, req.params.filename)
    if (!photo) {
      res.status(404).end()
      return
    }

    // Check that editor is the currently logged in user
    if (photo.author !== req.auth.callsign) {
      res.status(401).send('Cannot delete another user\'s photos').end()
      return
    }

    let update = {
      $set: {},
      $unset: {}
    }

    if (req.body.title) {
      update.$set['photos.$.title'] = req.body.title
    } else {
      update.$unset['photos.$.title'] = ''
    }

    if (req.body.date) {
      update.$set['photos.$.date'] = new Date(req.body.date)
    } else {
      update.$unset['photos.$.date'] = ''
    }

    if (req.body.coordinates) {
      update.$set['photos.$.coordinates'] = req.body.coordinates
      update.$set['photos.$.positioningError'] = req.body.positioningError
    } else {
      update.$unset['photos.$.coordinates'] = ''
      update.$unset['photos.$.positioningError'] = ''
    }

    if (req.body.direction !== null && req.body.direction !== undefined && req.body.direction !== '') {
      update.$set['photos.$.direction'] = req.body.direction
    } else {
      update.$unset['photos.$.direction'] = ''
    }

    if (req.body.isCover) {
      update.$set['photos.$.isCover'] = true

      // Only one photo can be the cover photo, so unmark all others first
      await db.getDb().collection('summits').updateOne(
        { code: summitCode },
        { $unset: { 'photos.$[].isCover': '' } }
      )
    } else {
      update.$unset['photos.$.isCover'] = ''
    }

    if (Object.keys(update.$set).length === 0) {
      delete update.$set
    }
    if (Object.keys(update.$unset).length === 0) {
      delete update.$unset
    }

    await db.getDb().collection('summits').updateOne(
      { code: summitCode, 'photos.filename': req.params.filename },
      update
    )

    res.status(204).end()
  } catch (err) {
    endServerError(res, err)
  }
})
