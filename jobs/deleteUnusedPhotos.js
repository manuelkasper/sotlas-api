const Minio = require('minio')
const MongoClient = require('mongodb').MongoClient
const assert = require('assert')
const config = require('../config')

let minAgeForDeletion = 7*86400*1000
let minExpectedPhotos = 30000
let maxDeletedPhotos = 1000

const client = new MongoClient(config.mongodb.url)
client.connect(async function (err) {
  assert.equal(null, err)
  let db = client.db(config.mongodb.dbName)

  // Obtain list of all used filenames from database
  let keepFilenames = new Set(await db.collection('summits').distinct('photos.filename', {'photos.filename': {'$ne': null}}))
  if (keepFilenames.size < minExpectedPhotos) {
    console.error(`Expected at least ${minExpectedPhotos} in DB, found only ${keepFilenames.size}`)
    client.close()
    return
  }

  // Check for unused files in regular storage
  await deleteFilesNotIn(config.photos.storage, '', keepFilenames)

  // Check for unused files in original storage
  await deleteFilesNotIn(config.photos.originalStorage, 'original/', keepFilenames)

  client.close()
});

async function deleteFilesNotIn(storage, prefix, keepFilenames) {
  let allFiles = await listFiles(storage, prefix)
  let filesToDelete = []
  let now = new Date()
  for (let file of allFiles) {
    let baseName = file.name.split(/[\\/]/).pop()
    if (!baseName.endsWith('.jpg') || (now.getTime() - file.lastModified.getTime()) < minAgeForDeletion) {
      continue
    }
    if (!keepFilenames.has(baseName)) {
      filesToDelete.push(file.name)
    }
  }
  if (filesToDelete.length > maxDeletedPhotos) {
    console.error(`Expected at most ${maxDeletedPhotos} files to delete, but found ${filesToDelete.length}`)
    return
  }
  await deleteFiles(storage, filesToDelete)
  console.log(`Deleted ${filesToDelete.length} files from ${storage.endPoint}:${storage.bucketName}`)
}

async function listFiles(storageConfig, targetPath) {
  let minioClient = new Minio.Client(storageConfig)
  return await minioClient.listObjectsV2(storageConfig.bucketName, targetPath, true).toArray()
}

async function deleteFiles(storageConfig, filePaths) {
  let minioClient = new Minio.Client(storageConfig)
  return await minioClient.removeObjects(storageConfig.bucketName, filePaths)
}
