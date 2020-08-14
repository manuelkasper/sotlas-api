const express = require('express')
const multer  = require('multer')
const config = require('./config')
const tracks = require('./tracks')
const jwt = require('express-jwt')
const jwksRsa = require('jwks-rsa')

let upload = multer({dest: config.tracks.uploadPath})

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

router.post('/upload', jwtCallback, upload.single('track'), (req, res) => {
  res.cacheControl = {
    noCache: true
  }

  if (!req.user.callsign) {
    res.status(401).send('Missing callsign in SSO token').end()
    return
  }

  if (req.file) {
    tracks.importTrack(req.file.path, req.user.callsign)
      .then(track => {
        res.json(track)
      })
      .catch(err => {
        console.error(err)
        res.status(500).end()
      })
  }
})
