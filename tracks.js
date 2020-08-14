const togeojson = require('togeojson')
const fsPromises = require('fs').promises
const DOMParser = require('xmldom').DOMParser
const simplify = require('@turf/simplify')
const togpx = require('togpx')
const hasha = require('hasha')
const path = require('path')
const config = require('./config')
const db = require('./db')

module.exports = {
  importTrack: async function(filename, author) {
    // Hash input file to determine filename
    let hash = await hasha.fromFile(filename, {algorithm: 'sha256'})
    let hashFilename = hash.substr(0, 32)
    let originalPath = config.tracks.paths.original + '/' + hashFilename.substr(0, 2) + '/' + hashFilename
    await fsPromises.mkdir(path.dirname(originalPath), {recursive: true})

    // Parse first to check if it's valid GPX/KML
    let gpxData = await fsPromises.readFile(filename, 'utf-8')
    let dom = new DOMParser().parseFromString(gpxData, 'text/xml')
    if (!dom) {
      throw new Error('Bad XML document')
    }
    let geojson
    if (dom.documentElement.tagName === 'kml') {
      geojson = togeojson.kml(dom)
      originalPath += '.kml'
    } else {
      geojson = togeojson.gpx(dom)
      originalPath += '.gpx'
    }

    if (geojson.type !== 'FeatureCollection') {
      throw new Error('Expected feature collection')
    }
    if (geojson.features.length === 0) {
      throw new Error('No features found')
    }

    await fsPromises.copyFile(filename, originalPath)

    // Remove times, if present
    geojson.features.forEach(feature => {
      if (feature.type !== 'Feature') {
        throw new Error('Expected feature')
      }

      if (feature.properties.coordTimes) {
        delete feature.properties.coordTimes
      }
    })

    let simplified = simplify(geojson, {tolerance: config.tracks.tolerance, highQuality: true})
    let simpleGpx = togpx(simplified)

    let outPath = config.tracks.paths.simple + '/' + hashFilename.substr(0, 2) + '/' + hashFilename + '.gpx'
    await fsPromises.mkdir(path.dirname(outPath), {recursive: true})
    await fsPromises.writeFile(outPath, simpleGpx)

    db.getDb().collection('uploads').insertOne({
      uploadDate: new Date(),
      type: 'track',
      filename: hashFilename + '.gpx',
      author
    })

    return {
      filename: hashFilename + '.gpx',
      author
    }
  }
}
