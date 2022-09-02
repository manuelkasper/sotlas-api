const cron = require('node-cron')
const child_process = require('child_process')
const config = require('./config')

module.exports = () => {
	config.cronjobs.forEach(cronjob => {
		cron.schedule(cronjob.schedule, () => {
			console.log(`Running job '${cronjob.script}'`)
			const start = Date.now()
			const child = child_process.fork('jobs/' + cronjob.script)
			child.on('error', err => {
				console.error(`[ALERT] Job '${cronjob.script}' failed: ${err}`)
			})
			child.on('close', code => {
				const end = Date.now()
				console.log(`Job '${cronjob.script}' ended with code ${code} in ${end - start} ms`)
			})
		})
	})
}
