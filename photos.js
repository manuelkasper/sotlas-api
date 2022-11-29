const sharp = require('sharp')
const crypto = require('crypto')
const fs = require('fs')
const fsPromises = require('fs').promises
const exif = require('exif-reader')
const path = require('path')
const hasha = require('hasha')
const minio = require('minio')
const promiseRetry = require('promise-retry')
const config = require('./config')
const db = require('./db')

module.exports = {
  importPhoto: async function(filename, author) {
    // Hash input file to determine filename
    let hash = await hasha.fromFile(filename, {algorithm: 'sha256'})
    let hashFilename = hash.substr(0, 32) + '.jpg'

    let metadata = await getMetadata(filename)
    if (metadata.format !== 'jpeg' && metadata.format != 'png' && metadata.format != 'heif') {
      throw new Error('Bad input format, must be JPEG, PNG or HEIF')
    }

    // Upload original photo to Backblaze (don't wait for completion)
    fsPromises.readFile(filename)
      .then(buffer => {
        promiseRetry((retry, number) => {
          return uploadToCloud(config.photos.originalStorage, 'original/' + hashFilename, buffer).catch(retry)
        }, {retries: 5})
        .catch(() => {
          console.error(`[ALERT] Cloud photo original upload failed for ${filename}`)
        })
      })

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
            !isNaN(exifParsed.gps.GPSLatitude[0]) && !isNaN(exifParsed.gps.GPSLongitude[0]) &&
            (exifParsed.gps.GPSLatitude[0] !== 0 || exifParsed.gps.GPSLatitude[1] !== 0 || exifParsed.gps.GPSLatitude[2] !== 0) &&
            (exifParsed.gps.GPSLongitude[0] !== 0 || exifParsed.gps.GPSLongitude[1] !== 0 || exifParsed.gps.GPSLongitude[2] !== 0)) {
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

    let tasks = []
    Object.keys(config.photos.sizes).forEach(sizeDescr => {
      tasks.push(
        makeResized(filename, config.photos.sizes[sizeDescr].width, config.photos.sizes[sizeDescr].height)
          .then(buffer => {
            return promiseRetry((retry, number) => {
              return uploadToCloud(config.photos.storage, sizeDescr + '/' + hashFilename, buffer).catch(retry)
            }, {retries: 2})
          })
      )
    })

    await Promise.all(tasks)

    db.getDb().collection('uploads').insertOne({
      uploadDate: new Date(),
      type: 'photo',
      filename: hashFilename,
      author
    })
    
    return photo
  }
}

function uploadToCloud(storageConfig, targetPath, buffer) {
  let minioClient = new minio.Client(storageConfig)
  let metadata = {
    'Content-Type': 'image/jpeg',
    'x-amz-acl': 'public-read'
  }
  return minioClient.putObject(storageConfig.bucketName, targetPath, buffer, metadata)
}

function getMetadata(src) {
  return sharp(src, { failOnError: false }).metadata()
}

function makeResized(src, maxWidth, maxHeight) {
  return sharp(src, { failOnError: false }).rotate().resize({ height: maxHeight, width: maxWidth, fit: 'inside' }).toBuffer()
}
