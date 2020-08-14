const express = require('express')
const multer  = require('multer')
const config = require('./config')
const photos = require('./photos')
const jwt = require('express-jwt')
const jwksRsa = require('jwks-rsa')
const nodemailer = require('nodemailer')
const db = require('./db')

let upload = multer({dest: config.photos.uploadPath})

let router = express.Router()
module.exports = router

let jwtCallback = jwt({
  secret: jwksRsa.expressJwtSecret({
    cache: true,
    rateLimit: true,
    jwksRequestsPerMinute: 5,
    jwksUri: config.sso.jwksUri
  })
})

router.post('/summits/:association/:code/upload', jwtCallback, upload.array('photo'), async (req, res) => {
  try {
    res.cacheControl = {
      noCache: true
    }
    
    if (!req.user.callsign) {
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
        let photo = await photos.importPhoto(file.path, req.user.callsign)
        dbPhotos.push(photo)
      }

      // Check for duplicates
      if (summit.photos) {
        dbPhotos = dbPhotos.filter(photo => !summit.photos.some(summitPhoto => summitPhoto.filename === photo.filename ))
      }

      if (dbPhotos.length > 0) {
        await db.getDb().collection('summits').updateOne({code: summitCode}, { $push: { photos: { $each: dbPhotos } } })

        let transporter = nodemailer.createTransport(config.mail)
        transporter.sendMail({
          from: 'api@sotl.as',
          to: 'mk@neon1.net',
          subject: 'New photos added to summit ' + summitCode + ' by ' + req.user.callsign,
          text: `${dbPhotos.length} new photos have been added. https://sotl.as/summits/${summitCode}\n`,
          attachments: dbPhotos.map(photo => {
            return {
              filename: photo.filename,
              path: config.photos.paths.thumb + '/' + photo.filename.substr(0, 2) + '/' + photo.filename
            }
          })
        })
      }

      res.json(dbPhotos)
    } else {
      res.status(400).end()
    }
  } catch (err) {
    console.error(err)
    res.status(500).end()
  }
})

router.delete('/summits/:association/:code/:filename', jwtCallback, async (req, res) => {
  res.cacheControl = {
    noCache: true
  }
  
  if (!req.user.callsign) {
    res.status(401).send('Missing callsign in SSO token').end()
    return
  }

  let summitCode = req.params.association + '/' + req.params.code
  let summit = await db.getDb().collection('summits').findOne({code: summitCode})
  let photo = summit.photos.find(photo => photo.filename === req.params.filename)
  if (!photo) {
    res.status(404).end()
    return
  }

  // Check that uploader is currently logged in user
  if (photo.author !== req.user.callsign) {
    res.status(401).send('Cannot delete another user\'s photos').end()
    return
  }

  await db.getDb().collection('summits').updateOne({code: summitCode}, { $pull: { photos: { filename: req.params.filename } } })

  res.status(204).end()
})

router.post('/summits/:association/:code/reorder', jwtCallback, async (req, res) => {
  res.cacheControl = {
    noCache: true
  }

  if (!req.user.callsign) {
    res.status(401).send('Missing callsign in SSO token').end()
    return
  }

  let summitCode = req.params.association + '/' + req.params.code

  // Assign new sortOrder index to photos of this user, in the order given by req.body.filenames
  let updates = req.body.filenames.map((filename, index) => {
    return db.getDb().collection('summits').updateOne(
      { code: summitCode, 'photos.author': req.user.callsign, 'photos.filename': filename },
      { $set: { 'photos.$.sortOrder': index + 1 } }
    )
  })

  await Promise.all(updates)

  res.status(204).end()
})

router.post('/summits/:association/:code/:filename', jwtCallback, async (req, res) => {
  res.cacheControl = {
    noCache: true
  }

  if (!req.user.callsign) {
    res.status(401).send('Missing callsign in SSO token').end()
    return
  }

  let summitCode = req.params.association + '/' + req.params.code
  let summit = await db.getDb().collection('summits').findOne({code: summitCode})
  let photo = summit.photos.find(photo => photo.filename === req.params.filename)
  if (!photo) {
    res.status(404).end()
    return
  }

  // Check that editor is the currently logged in user
  if (photo.author !== req.user.callsign) {
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
})
