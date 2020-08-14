const MongoClient = require('mongodb').MongoClient
const config = require('../config')
const assert = require('assert')
const photos = require('../photos')
const db = require('../db')

let author = process.argv[2]
if (!author) {
  console.error("usage: author file file ...")
  process.exit(0)
}

db.waitDb(() => {
  let imports = []
  process.argv.slice(3).forEach(filename => {
    imports.push(photos.importPhoto(filename, author))
  })

  // Run imports in series
  return imports.reduce((promiseChain, currentImport) => {
    return promiseChain.then(chainResults =>
      currentImport.then(currentResult =>
        [ ...chainResults, currentResult ]
      )
    )
  }, Promise.resolve([])).then(photos => {
    console.log(JSON.stringify(photos))

    db.closeDb()
  }).catch(err => {
    console.error(err)
  })
})
