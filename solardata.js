const express = require('express')
const {check} = require('express-validator')
const axios = require('axios')
const moment = require('moment')
const config = require('./config')
const db = require('./db')

let router = express.Router()
module.exports = router

router.get('/latest', (req, res) => {
	db.getDb().collection('solardata').find().sort({date: -1, hour: -1}).limit(1).toArray((err, solardataArr) => {
		if (err) {
			return res.status(500).end()
		}

		let solardata = solardataArr[0]

		if (!solardata) {
			return res.status(404).end()
		}

		// Check that the data is not older than 4 hours
		let solardataMoment = moment.utc(solardata.date + "T" + solardata.hour.toString().padStart(2, '0'))
		if (moment.utc().diff(solardataMoment, 'hours') > 4) {
			return res.status(404).end()
		}

		delete solardata._id
		delete solardata.date
		delete solardata.hour

		return res.json(solardata)
	})
})

router.get('/history/:hours',
	check("hours").isInt({gt: 0, lt: 1000}),
	(req, res) => {
	db.getDb().collection('solardata').find().sort({date: -1, hour: -1}).limit(parseInt(req.params.hours)).toArray((err, solardataArr) => {
		if (err) {
			return res.status(500).end()
		}

		for (let solardata of solardataArr) {
			delete solardata._id
		}

		return res.json(solardataArr)
	})
})

router.get('/:date/:hour',
	check("date").matches(/^\d\d\d\d-\d\d-\d\d$/),
	check("hour").isInt({gt: -1, lt: 24}),
	(req, res) => {

	db.getDb().collection('solardata').findOne({date: req.params.date, hour: req.params.hour}, (err, solardata) => {
		if (err) {
			return res.status(500).end()
		}

		if (!solardata) {
			return res.status(404).end()
		}

		delete solardata._id
		delete solardata.date
		delete solardata.hour

		return res.json(solardata)
	})
})

const axiosOpts = {
	timeout: 15000,
	headers: {'User-Agent': 'sotlas-api'}
}

function parseInteger(value) {
	let parsed = parseInt(value, 10)
	return Number.isFinite(parsed) ? parsed : null
}

function parseWwv(text) {
	let sfiMatch = text.match(/Solar flux\s+(\d+)/i)
	let aMatch = text.match(/A-index\s+(\d+)/i)
	let kMatch = text.match(/K-index.*?was\s+([\d.]+)/i)

	let k = kMatch ? parseFloat(kMatch[1]) : NaN

	return {
		sfi: sfiMatch ? parseInteger(sfiMatch[1]) : null,
		a: aMatch ? parseInteger(aMatch[1]) : null,
		k: Number.isFinite(k) ? Math.round(k) : null
	}
}

function parseDailySolarIndices(text) {
	let lines = text.split(/\r?\n/).filter(line => /^\d{4}\s+\d{1,2}\s+\d{1,2}\s+/.test(line))

	for (let i = lines.length - 1; i >= 0; i--) {
		let parts = lines[i].trim().split(/\s+/)
		let sfi = parseInteger(parts[3])
		let r = parseInteger(parts[4])
		if (sfi !== null && sfi >= 0 && r !== null && r >= 0) {
			return {sfi, r}
		}
	}

	return {sfi: null, r: null}
}

async function fetchSolarData() {
	let [wwvRes, dsdRes] = await Promise.allSettled([
		axios.get(config.solardata.wwvUrl, axiosOpts),
		axios.get(config.solardata.dailySolarIndicesUrl, axiosOpts)
	])

	if (wwvRes.status === 'rejected') {
		console.error('Failed to fetch NOAA WWV solar data:', wwvRes.reason.message || wwvRes.reason)
	}
	if (dsdRes.status === 'rejected') {
		console.error('Failed to fetch NOAA daily solar indices:', dsdRes.reason.message || dsdRes.reason)
	}

	let wwv = wwvRes.status === 'fulfilled' ? parseWwv(wwvRes.value.data) : {}
	let dsd = dsdRes.status === 'fulfilled' ? parseDailySolarIndices(dsdRes.value.data) : {}

	let sfi = wwv.sfi != null ? wwv.sfi : dsd.sfi
	let r = dsd.r
	let a = wwv.a
	let k = wwv.k

	if (![sfi, r, a, k].every(Number.isFinite)) {
		throw new Error(`Incomplete solar data (sfi=${sfi}, r=${r}, a=${a}, k=${k})`)
	}

	return {sfi, r, a, k}
}

let updating = false

async function updateSolarData() {
	if (updating) {
		return
	}

	updating = true
	try {
		let values = await fetchSolarData()
		let now = moment.utc()
		let date = now.format('YYYY-MM-DD')
		let hour = now.hour()

		await db.getDb().collection('solardata').replaceOne({date, hour}, {
			date,
			hour,
			sfi: values.sfi,
			r: values.r,
			a: values.a,
			k: values.k
		}, {upsert: true})

		console.log(`Updated solar data for ${date} ${hour}:00 UTC (SFI ${values.sfi}, SSN ${values.r}, A ${values.a}, K ${values.k})`)
	} catch (err) {
		console.error('Solar data update failed:', err.message || err)
	} finally {
		updating = false
	}
}

function start() {
	updateSolarData()
	setInterval(updateSolarData, config.solardata.updateInterval)
}

module.exports.start = start
