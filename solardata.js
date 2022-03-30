const express = require('express')
const {check, validationResult} = require('express-validator')
const config = require('./config')
const db = require('./db')

let router = express.Router()
module.exports = router

router.get('/:date/:hour',
	check("date").matches(/^\d\d\d\d-\d\d-\d\d$/),
	check("hour").isInt({gt: -1, lt: 24}),
	(req, res) => {

	db.getDb().collection('solardata').findOne({date: req.params.date, hour: req.params.hour}, (err, solardata) => {
		if (err) {
			return res.status(500).end();
		}

		if (!solardata) {
			return res.status(404).end();
		}

		delete solardata._id
		delete solardata.date
		delete solardata.hour

		return res.json(solardata)
	})
})

router.get('/latest', (req, res) => {
	db.getDb().collection('solardata').find().sort({date: -1, hour: -1}).limit(1).toArray((err, solardataArr) => {
		if (err) {
			return res.status(500).end();
		}

		let solardata = solardataArr[0]

		if (!solardata) {
			return res.status(404).end();
		}

		delete solardata._id
		delete solardata.date
		delete solardata.hour

		return res.json(solardata)
	})
})

router.post('/:date/:hour',
	check("date").matches(/^\d\d\d\d-\d\d-\d\d$/),
	check("hour").isInt({gt: -1, lt: 24}),
	check(['sfi', 'r', 'a', 'k', 'expK']).isInt(),
	check('aurora').isBoolean(),
	(req, res) => {

	if (req.body.apiKey !== config.solardata.apiKey) {
		return res.status(401).end()
	}

	const errors = validationResult(req);
	if (!errors.isEmpty()) {
		return res.status(400).json({errors: errors.array()})
	}

	db.getDb().collection('solardata').replaceOne({date: req.params.date, hour: req.params.hour}, {
		date: req.params.date,
		hour: req.params.hour,
		sfi: req.body.sfi,
		r: req.body.r,
		a: req.body.a,
		k: req.body.k,
		expK: req.body.expK,
		sa: req.body.sa,
		gmf: req.body.gmf,
		aurora: req.body.aurora
	}, {upsert: true})
	return res.status(204).end()
})
