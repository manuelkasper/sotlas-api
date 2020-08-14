const sharp = require('sharp')
const crypto = require('crypto')
const fs = require('fs')
const fsPromises = require('fs').promises
const exif = require('exif-reader')
const path = require('path')
const hasha = require('hasha')
const config = require('./config')
const db = require('./db')

module.exports = {
  importPhoto: async function(filename, author) {
    // Hash input file to determine filename
    let hash = await hasha.fromFile(filename, {algorithm: 'sha256'})
    let hashFilename = hash.substr(0, 32) + '.jpg'
    let originalPath = config.photos.paths.original + '/' + hashFilename.substr(0, 2) + '/' + hashFilename
    await fsPromises.mkdir(path.dirname(originalPath), {recursive: true})

    let metadata = await getMetadata(filename)
    if (metadata.format !== 'jpeg' && metadata.format != 'png' && metadata.format != 'heif') {
      throw new Error('Bad input format, must be JPEG, PNG or HEIF')
    }

    await fsPromises.copyFile(filename, originalPath)

    let photo = {
      filename: hashFilename,
      width: Math.round(metadata.width),
      height: Math.round(metadata.height),
      author,
      uploadDate: new Date()
    }

    if (metadata.orientation && metadata.orientation >= 5) {
      // Swap width/height
      let tmp = photo.width
      photo.width = photo.height
      photo.height = tmp
    }

    if (metadata.exif) {
      let exifParsed = exif(metadata.exif)
      if (exifParsed) {
        if (exifParsed.gps && exifParsed.gps.GPSLatitude && exifParsed.gps.GPSLongitude &&
            (!exifParsed.gps.GPSStatus || exifParsed.gps.GPSStatus === 'A') && 
            !isNaN(exifParsed.gps.GPSLatitude[0]) && !isNaN(exifParsed.gps.GPSLongitude[0])) {
          photo.coordinates = {}
          photo.coordinates.latitude = exifParsed.gps.GPSLatitude[0] + exifParsed.gps.GPSLatitude[1]/60 + exifParsed.gps.GPSLatitude[2]/3600
          if (exifParsed.gps.GPSLatitudeRef === 'S') {
            photo.coordinates.latitude = -photo.coordinates.latitude
          }
          photo.coordinates.longitude = exifParsed.gps.GPSLongitude[0] + exifParsed.gps.GPSLongitude[1]/60 + exifParsed.gps.GPSLongitude[2]/3600
          if (exifParsed.gps.GPSLongitudeRef === 'W') {
            photo.coordinates.longitude = -photo.coordinates.longitude
          }

          if (exifParsed.gps.GPSImgDirection && exifParsed.gps.GPSImgDirection >= 0 && exifParsed.gps.GPSImgDirection < 360) {
            photo.direction = Math.round(exifParsed.gps.GPSImgDirection)
          }

          if (exifParsed.gps.GPSHPositioningError) {
            photo.positioningError = Math.round(exifParsed.gps.GPSHPositioningError)
          }
        }

        if (exifParsed.image && exifParsed.image.Make && exifParsed.image.Model) {
          photo.camera = exifParsed.image.Make + ' ' + exifParsed.image.Model
        }

        if (exifParsed.exif) {
          if (exifParsed.exif.DateTimeDigitized) {
            photo.date = exifParsed.exif.DateTimeDigitized
          } else if (exifParsed.exif.DateTimeOriginal) {
            photo.date = exifParsed.exif.DateTimeOriginal
          }
        }
      }
    }

    let mkdirTasks = []
    let resizeTasks = []
    Object.keys(config.photos.sizes).forEach(sizeDescr => {
      let outPath = config.photos.paths[sizeDescr] + '/' + hashFilename.substr(0, 2) + '/' + hashFilename
      mkdirTasks.push(fsPromises.mkdir(path.dirname(outPath), {recursive: true}))
      resizeTasks.push(makeResized(originalPath, outPath, config.photos.sizes[sizeDescr].width, config.photos.sizes[sizeDescr].height))
    })

    await Promise.all(mkdirTasks)
    await Promise.all(resizeTasks)

    db.getDb().collection('uploads').insertOne({
      uploadDate: new Date(),
      type: 'photo',
      filename: hashFilename,
      author
    })
    
    return photo
  }
}

function getMetadata(src) {
  return sharp(src).metadata()
}

function makeResized(src, dst, maxWidth, maxHeight) {
  return sharp(src).rotate().resize({ height: maxHeight, width: maxWidth, fit: 'inside' }).toFile(dst)
}
